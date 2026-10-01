'use client'

import type { ExtractedMaterial } from '@testmaker/core/schema'
import { skipReason } from '@testmaker/core/extract'
import type { ExtractResponse } from '@/workers/extract.worker'
import { jsonBody, requestJson } from '@/lib/requestJson'

export interface FileEntry {
  file: File
  relativePath: string
}

export interface Triage {
  accepted: FileEntry[]
  skipped: { relativePath: string; reason: string }[]
}

/**
 * Soubory z `<input type=file>`. U výběru složky nese cestu `webkitRelativePath`,
 * u výběru jednotlivých souborů žádná cesta není — zbude samotný název.
 */
export function entriesFromInput(files: FileList | null): FileEntry[] {
  return Array.from(files ?? []).map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }))
}

/** Rozdělí soubory na ty ke zpracování a přeskočené i s důvodem. */
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
 * Soubory z přetažení, včetně celých složek.
 *
 * Přetažená složka se v `dataTransfer.files` tváří jako jediný soubor bez
 * obsahu — projít se dá jedině přes `webkitGetAsEntry`. Když prohlížeč tohle
 * rozhraní nemá, zbydou aspoň jednotlivé soubory.
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
  // `readEntries` vrací složku po dávkách (v Chrome po stovce), dokud nedojdou.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]))
    })
    if (batch.length === 0) return
    for (const child of batch) await walkDropEntry(child, relativePath, out)
  }
}

/** Zpracuje soubory ve workeru; `onResult` dostane každý výsledek hned. */
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
  /** Nahrání rovnou do tohoto tématu — pole subject/grade/topic materiálu se ignorují. */
  topicId?: string
  batchSize?: number
  onProgress?: (done: number, total: number) => void
}

/** Odešle materiály po dávkách; vrátí souhrn. */
export async function uploadMaterials(
  items: ExtractedMaterial[],
  options: UploadOptions = {},
): Promise<{ imported: number; duplicates: number }> {
  const { topicId, batchSize = 10, onProgress } = options
  let imported = 0
  let duplicates = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    // Server posílá vysvětlení česky (neplatná data, téma se nenašlo); syrové
    // tělo odpovědi (třeba HTML chybové stránky) by učitelce nic neřeklo.
    const result = await requestJson<{ imported: number; duplicates: number }>(
      '/api/materials',
      jsonBody('POST', { materials: batch, ...(topicId ? { topicId } : {}) }),
      imported + duplicates > 0
        ? 'Část souborů se uložila, zbytek ne — nahraj je znovu, uložené se nezdvojí.'
        : 'Soubory se nepodařilo uložit.',
    )
    imported += result.imported ?? 0
    duplicates += result.duplicates ?? 0
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
  }

  return { imported, duplicates }
}

/** Kam se dá po importu pokračovat: rovnou do tématu, nebo do jeho ročníku. */
export interface ImportDestination {
  topicId: string
  topicName: string
  gradeId: string | null
  gradeName: string
}

/**
 * Dohledá v knihovně téma, do kterého import spadl.
 *
 * Server může název tématu při slučování zvolit jinak, než ho učitelka
 * napsala („Měkkýši“ místo „6.22 Měkkýši (Mollusca)“), proto se hledá
 * a shoda se ověřuje přes předmět a ročník, ne přes uhodnuté id.
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
