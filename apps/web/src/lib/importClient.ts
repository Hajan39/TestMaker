'use client'

import type { ExtractedMaterial } from '@testmaker/core/schema'
import { skipReason } from '@testmaker/core/extract'
import type { ExtractResponse } from '@/workers/extract.worker'

export interface FileEntry {
  file: File
  relativePath: string
}

/** Vybere soubory ke zpracování a rovnou vrátí i přeskočené s důvodem. */
export function triageFiles(files: FileList | File[]): {
  accepted: FileEntry[]
  skipped: { relativePath: string; reason: string }[]
} {
  const accepted: FileEntry[] = []
  const skipped: { relativePath: string; reason: string }[] = []

  for (const file of Array.from(files)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const reason = skipReason(relativePath)
    if (reason) skipped.push({ relativePath, reason })
    else accepted.push({ file, relativePath })
  }

  return { accepted, skipped }
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

/** Odešle materiály po dávkách; vrátí souhrn. */
export async function uploadMaterials(
  items: ExtractedMaterial[],
  onProgress?: (done: number, total: number) => void,
  batchSize = 10,
): Promise<{ imported: number; duplicates: number }> {
  let imported = 0
  let duplicates = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const response = await fetch('/api/materials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ materials: batch }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Import selhal (${response.status}): ${detail.slice(0, 200)}`)
    }
    const result = (await response.json()) as { imported: number; duplicates: number }
    imported += result.imported
    duplicates += result.duplicates
    onProgress?.(Math.min(i + batchSize, items.length), items.length)
  }

  return { imported, duplicates }
}
