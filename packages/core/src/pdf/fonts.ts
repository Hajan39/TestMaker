import { Font } from '@react-pdf/renderer'

/**
 * Registrace fontů s českou diakritikou. Volá se jednou před prvním renderem.
 * Na serveru se čtou soubory z `assets/fonts`, v prohlížeči se stahují z `/fonts`.
 */
let registered = false

export interface FontSource {
  family: 'NotoSans' | 'NotoSerif'
  regular: string | Buffer
  bold: string | Buffer
  italic: string | Buffer
}

export function registerFonts(sources: FontSource[]): void {
  if (registered) return
  for (const source of sources) {
    Font.register({
      family: source.family,
      fonts: [
        { src: source.regular as string, fontWeight: 'normal' },
        { src: source.bold as string, fontWeight: 'bold' },
        { src: source.italic as string, fontStyle: 'italic' },
      ],
    })
  }
  // Dělení slov vypnuto — čeština se v react-pdf dělí špatně.
  Font.registerHyphenationCallback((word) => [word])
  registered = true
}

export const FONT_FILES = {
  NotoSans: {
    regular: 'NotoSans-Regular.ttf',
    bold: 'NotoSans-Bold.ttf',
    italic: 'NotoSans-Italic.ttf',
  },
  NotoSerif: {
    regular: 'NotoSerif-Regular.ttf',
    bold: 'NotoSerif-Bold.ttf',
    italic: 'NotoSerif-Italic.ttf',
  },
} as const
