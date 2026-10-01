'use client'

import type { ExtractedMaterial } from '@testmaker/core/schema'
import { skipReason } from '@testmaker/core/extract'
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

/** Processes the files in a worker; `onResult` gets each result right away. */
export async function extractAll(
  entries: FileEntry[],
  onResult: (result: ExtractResponse) => void,
): Promise<void> {
  const worker = new Worker(new URL('../workers/extract.worker.ts', import.meta.url), {
    type: 'module',
  })

  try {
    for (const [index, entry] of entries.entries()) {
      const result = await new Promise<ExtractResponse>((resolve, reject) => {
        const onMessage = (event: MessageEvent<ExtractResponse>) => {
          worker.removeEventListener('message', onMessage)
          resolve(event.data)
        }
        worker.addEventListener('message', onMessage, { once: true })
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
}

/** Sends materials in batches; returns a summary. */
export async function uploadMaterials(
  items: ExtractedMaterial[],
  options: UploadOptions = {},
): Promise<{ imported: number; duplicates: number }> {
  const { topicId, batchSize = 10, onProgress } = options
  let imported = 0
  let duplicates = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    // The server sends a readable explanation (invalid data, topic not found);
    // a raw response body (say an HTML error page) would tell the teacher nothing.
    const result = await requestJson<{ imported: number; duplicates: number }>(
      '/api/materials',
      jsonBody('POST', { materials: batch, ...(topicId ? { topicId } : {}) }),
      imported + duplicates > 0
        ? t('library:importClient.partiallySaved')
        : t('library:importClient.saveFailed'),
    )
    imported += result.imported ?? 0
    duplicates += result.duplicates ?? 0
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
  }

  return { imported, duplicates }
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
