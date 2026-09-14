import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FILES, registerFonts } from './fonts.js'

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
