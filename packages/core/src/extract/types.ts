export interface ExtractionResult {
  text: string
  pageCount: number | null
  /** Text je podezřele krátký vůči počtu stran → sken bez textové vrstvy. */
  needsOcr: boolean
}

export class UnsupportedFileError extends Error {
  constructor(
    readonly fileName: string,
    readonly hint: string,
  ) {
    super(`Nepodporovaný soubor: ${fileName}. ${hint}`)
    this.name = 'UnsupportedFileError'
  }
}

/** Sjednotí bílé znaky a odstraní osamocené prázdné řádky. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
