/// <reference lib="webworker" />
/**
 * Text extraction runs in a web worker so large PDFs and presentations don't
 * block the UI. Only the text goes to the server — originals (up to 180 MB) never leave.
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
