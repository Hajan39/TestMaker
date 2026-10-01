import { t } from '../i18n'

export interface ExtractionResult {
  text: string
  pageCount: number | null
  /** Text is suspiciously short for the page count → a scan without a text layer. */
  needsOcr: boolean
}

export class UnsupportedFileError extends Error {
  constructor(
    readonly fileName: string,
    readonly hint: string,
  ) {
    super(t('core:extract.unsupported', { fileName, hint }))
    this.name = 'UnsupportedFileError'
  }
}

/** Unifies whitespace and removes stray blank lines. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
