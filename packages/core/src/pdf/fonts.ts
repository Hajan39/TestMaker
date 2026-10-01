import { Font } from '@react-pdf/renderer'

/**
 * Registers fonts with Czech diacritics. Called once before the first render.
 * On the server files are read from `assets/fonts`, in the browser they are fetched from `/fonts`.
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
  // Hyphenation disabled — react-pdf hyphenates Czech badly.
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
