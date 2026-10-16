'use client'

import type { ExtractedMaterial } from '@testmaker/core/schema'
import { isImageFile, needsDom, processedFromText, processFile, skipReason } from '@testmaker/core/extract'
import { upload } from '@vercel/blob/client'
import { imageToText } from '@/lib/imageText'
import { MAX_ORIGINAL_BYTES } from '@/lib/materials'
import type { ExtractResponse } from '@/workers/extract.worker'
import { jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

export interface FileEntry {
  file: File
  relativePath: string
}

export interface Triage {
  accepted: FileEntry[]
  skipped: { relativePath: string; reason: string }[]
}

/**
 * Files from `<input type=file>`. A folder pick carries the path in
 * `webkitRelativePath`; picking single files has no path — just the name remains.
 */
export function entriesFromInput(files: FileList | null): FileEntry[] {
  return Array.from(files ?? []).map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }))
}

/** Splits files into those to process and the skipped ones with a reason. */
export function triageEntries(entries: FileEntry[]): Triage {
  const accepted: FileEntry[] = []
  const skipped: { relativePath: string; reason: string }[] = []

  for (const entry of entries) {
    const reason = skipReason(entry.relativePath)
    if (reason) skipped.push({ relativePath: entry.relativePath, reason })
    else accepted.push(entry)
  }

  return { accepted, skipped }
}

/**
 * Files from a drag and drop, including whole folders.
 *
 * A dropped folder shows up in `dataTransfer.files` as a single empty file —
 * it can only be walked via `webkitGetAsEntry`. When the browser lacks that
 * API, at least the individual files remain.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<FileEntry[]> {
  const roots = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (roots.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({ file, relativePath: file.name }))
  }

  const collected: FileEntry[] = []
  for (const root of roots) await walkDropEntry(root, '', collected)
  return collected
}

async function walkDropEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: FileEntry[],
): Promise<void> {
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      ;(entry as FileSystemFileEntry).file(resolve, () => resolve(null))
    })
    if (file) out.push({ file, relativePath })
    return
  }

  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  // `readEntries` returns the folder in batches (a hundred in Chrome) until exhausted.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]))
    })
    if (batch.length === 0) return
    for (const child of batch) await walkDropEntry(child, relativePath, out)
  }
}

/**
 * Processes the files; `onResult` gets each result right away. PDFs, which
 * tend to be large and slow to read, go to a worker so the UI does not freeze.
 * Documents and presentations need `DOMParser`, which a worker lacks — they
 * are read here; from the unzipped archive it is only a single XML file.
 */
export async function extractAll(
  entries: FileEntry[],
  onResult: (result: ExtractResponse) => void,
): Promise<void> {
  const worker = new Worker(new URL('../workers/extract.worker.ts', import.meta.url), {
    type: 'module',
  })

  try {
    for (const [index, entry] of entries.entries()) {
      if (isImageFile(entry.file.name)) {
        // A photo: its text is read by the model, or by OCR in the browser.
        try {
          const text = await imageToText(entry.file)
          onResult({ id: index, ...(await processedFromText(entry.file, entry.relativePath, { text, pageCount: null, needsOcr: false })) })
        } catch (error) {
          onResult({
            id: index,
            status: 'error',
            relativePath: entry.relativePath,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        continue
      }
      if (needsDom(entry.file.name)) {
        onResult({ id: index, ...(await processFile(entry.file, entry.relativePath)) })
        continue
      }
      const result = await new Promise<ExtractResponse>((resolve, reject) => {
        // Once loaded, the pdf.js worker module hooks onto this worker's
        // messages and posts its own "ready" here — so the result is
        // recognised by `id`, not by being the first message to arrive.
        const onMessage = (event: MessageEvent<ExtractResponse>) => {
          if (event.data?.id !== index) return
          worker.removeEventListener('message', onMessage)
          resolve(event.data)
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true })
        worker.postMessage({ id: index, file: entry.file, relativePath: entry.relativePath })
      })
      onResult(result)
    }
  } finally {
    worker.terminate()
  }
}

export interface UploadOptions {
  /** Upload straight into this topic — the material's subject/grade/topic fields are ignored. */
  topicId?: string
  batchSize?: number
  onProgress?: (done: number, total: number) => void
  /**
   * Original files by `relativePath`. Each newly saved material gets its file
   * uploaded to Blob storage when the server offers a place for it.
   */
  files?: Map<string, File>
}

export interface UploadSummary {
  imported: number
  duplicates: number
  /** Materials saved with their text whose original could not be stored. */
  originalsFailed: number
}

/**
 * Sends materials in batches; returns a summary. The text is saved first and
 * the original uploaded only afterwards — a failed original upload costs the
 * download, never the material itself.
 */
export async function uploadMaterials(items: ExtractedMaterial[], options: UploadOptions = {}): Promise<UploadSummary> {
  const { topicId, batchSize = 10, onProgress, files } = options
  let imported = 0
  let duplicates = 0
  let originalsFailed = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    // The server sends a readable explanation (invalid data, topic not found);
    // a raw response body (say an HTML error page) would tell the teacher nothing.
    const result = await requestJson<{
      imported: number
      duplicates: number
      created: { id: string; relativePath: string; originalPathname: string | null }[]
    }>(
      '/api/materials',
      jsonBody('POST', { materials: batch, ...(topicId ? { topicId } : {}) }),
      imported + duplicates > 0
        ? t('library:importClient.partiallySaved')
        : t('library:importClient.saveFailed'),
    )
    imported += result.imported ?? 0
    duplicates += result.duplicates ?? 0

    for (const created of result.created ?? []) {
      const file = files?.get(created.relativePath)
      // No pathname = the server keeps no originals (Blob not configured).
      if (!created.originalPathname || !file || file.size > MAX_ORIGINAL_BYTES) continue
      const contentType = batch.find((item) => item.relativePath === created.relativePath)?.mimeType
      try {
        await uploadOriginal(created.id, created.originalPathname, file, contentType || 'application/octet-stream')
      } catch (error) {
        console.error('Original upload failed:', created.relativePath, error)
        originalsFailed += 1
      }
    }
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
  }

  return { imported, duplicates, originalsFailed }
}

/** Uploads one original straight to Blob storage and links it to its material. */
async function uploadOriginal(materialId: string, pathname: string, file: File, contentType: string): Promise<void> {
  const route = `/api/materials/${encodeURIComponent(materialId)}/original`
  await upload(pathname, file, {
    access: 'private',
    handleUploadUrl: route,
    contentType,
    // Parts upload in parallel and retry on their own — worth it for big presentations.
    multipart: file.size > 8 * 1024 * 1024,
  })
  await requestJson(route, { method: 'PUT' }, t('library:materialPreview.originalRefused'))
}

/** Where to continue after import: straight into the topic, or into its grade. */
export interface ImportDestination {
  topicId: string
  topicName: string
  gradeId: string | null
  gradeName: string
}

/**
 * Finds the library topic the import landed in.
 *
 * When merging, the server may pick a different topic name than the teacher
 * typed ("Měkkýši" instead of "6.22 Měkkýši (Mollusca)"), so it is searched
 * and the match is verified by subject and grade, not by a guessed id.
 */
export async function lookupDestination(
  subject: string,
  grade: string,
  topic: string,
): Promise<ImportDestination | null> {
  const found = await fetch(`/api/library/search?q=${encodeURIComponent(topic.slice(0, 40))}`)
  if (!found.ok) return null
  const { results } = (await found.json()) as {
    results: { topicId: string; topicName: string; subjectName: string; gradeName: string }[]
  }

  const match =
    results.find(
      (result) =>
        result.subjectName === subject &&
        result.gradeName === grade &&
        (result.topicName === topic || topic.includes(result.topicName)),
    ) ?? results.find((result) => result.subjectName === subject && result.gradeName === grade)
  if (!match) return null

  const grades = await fetch(`/api/topics?gradesOf=${encodeURIComponent(match.topicId)}`)
  const gradeId = grades.ok
    ? (((await grades.json()) as { grades: { id: string; name: string }[] }).grades.find(
        (row) => row.name === match.gradeName,
      )?.id ?? null)
    : null

  return {
    topicId: match.topicId,
    topicName: match.topicName,
    gradeId,
    gradeName: match.gradeName,
  }
}
