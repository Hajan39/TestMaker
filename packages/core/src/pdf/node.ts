import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import type { RenderableTest } from '../schema/test'
import { FONT_FILES, registerFonts } from './fonts'
import { TestDocument } from './TestDocument'

/** Directory with the TTF files shipped with the package. */
export const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts')

/** Registers fonts for server rendering (Node runtime) — react-pdf reads paths from the file system. */
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
 * Renders a test to PDF. Font registration and rendering must use the same
 * react-pdf instance, so the whole render lives here, not in the caller.
 */
export async function renderTestToBuffer(renderable: RenderableTest): Promise<Buffer> {
  registerServerFonts()
  return renderToBuffer(createElement(TestDocument, renderable) as never)
}
