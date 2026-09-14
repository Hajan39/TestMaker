/// <reference lib="webworker" />
/**
 * Extrakce textu běží ve web workeru, aby velké PDF a prezentace neblokovaly UI.
 * Na server se posílá jen text — originály (až 180 MB) nikam neputují.
 */
import { processFile, type ProcessedFile } from '@testmaker/core/extract'

export interface ExtractRequest {
  id: number
  file: File
  relativePath: string
}

export interface ExtractResponse extends ProcessedFile {
  id: number
}

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { id, file, relativePath } = event.data
  const result = await processFile(file, relativePath)
  ;(self as unknown as Worker).postMessage({ id, ...result } satisfies ExtractResponse)
}
