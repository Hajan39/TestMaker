import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type { RenderableTest } from '../schema/test'
import { FONT_FILES, registerFonts } from './fonts'
import { TestDocument } from './TestDocument'

/** Adresář s TTF soubory dodávanými s balíčkem. */
export const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts')

/** Registrace fontů pro render na serveru (Node runtime) — react-pdf čte cesty ze souborového systému. */
export function registerServerFonts(fontDir = FONT_DIR): void {
  registerFonts(
    (Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[]).map((family) => ({
      family,
      regular: resolve(fontDir, FONT_FILES[family].regular),
      bold: resolve(fontDir, FONT_FILES[family].bold),
      italic: resolve(fontDir, FONT_FILES[family].italic),
    })),
  )
}

/**
 * Vykreslí test do PDF. Registrace fontů i render musí proběhnout nad touž
 * instancí react-pdf, proto je celý render tady a ne u volajícího.
 */
export async function renderTestToBuffer(renderable: RenderableTest): Promise<Buffer> {
  registerServerFonts()
  return renderToBuffer(createElement(TestDocument, renderable) as never)
}
