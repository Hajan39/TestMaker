import type { TemplateTheme } from '../schema/template'

/** A4 in PDF points — decorations are placed on the whole page, in its margins. */
export const PAGE_WIDTH = 595.28
export const PAGE_HEIGHT = 841.89

export type DecorationShape =
  | { kind: 'circle'; cx: number; cy: number; r: number; tone: 'accent' | 'soft' }
  | { kind: 'path'; d: string; tone: 'accent' | 'soft' }

/** A five-pointed star as an SVG path. */
function star(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.45
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    return `${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`
  })
  return `M ${points.join(' L ')} Z`
}

/** A wavy band along the top (or bottom) edge of the page. */
function wave(y: number, amplitude: number, flip: boolean): string {
  const step = PAGE_WIDTH / 8
  let d = `M 0 ${flip ? PAGE_HEIGHT : 0} L 0 ${y}`
  for (let i = 0; i < 8; i += 1) {
    const x = i * step
    d += ` Q ${(x + step / 2).toFixed(1)} ${(y + (i % 2 === 0 ? amplitude : -amplitude)).toFixed(1)} ${(x + step).toFixed(1)} ${y}`
  }
  return `${d} L ${PAGE_WIDTH} ${flip ? PAGE_HEIGHT : 0} Z`
}

/**
 * Shapes of a page decoration. They stay inside the page margins (about 12 mm
 * from the edge at most), so they never cover content. The PDF and the
 * builder's paper both draw from this one list.
 */
export function decorationShapes(decoration: TemplateTheme['decoration']): DecorationShape[] {
  const W = PAGE_WIDTH
  const H = PAGE_HEIGHT
  switch (decoration) {
    case 'dots':
      return [
        { kind: 'circle', cx: W - 22, cy: 20, r: 12, tone: 'soft' },
        { kind: 'circle', cx: W - 46, cy: 14, r: 6, tone: 'accent' },
        { kind: 'circle', cx: W - 14, cy: 44, r: 5, tone: 'accent' },
        // Bottom left stays above the footer line.
        { kind: 'circle', cx: 20, cy: H - 62, r: 11, tone: 'soft' },
        { kind: 'circle', cx: 13, cy: H - 88, r: 5, tone: 'accent' },
        { kind: 'circle', cx: 26, cy: H - 40, r: 5, tone: 'accent' },
      ]
    case 'waves':
      return [
        { kind: 'path', d: wave(18, 6, false), tone: 'soft' },
        { kind: 'path', d: wave(H - 14, 5, true), tone: 'soft' },
      ]
    case 'stars':
      return [
        { kind: 'path', d: star(W - 26, 24, 13), tone: 'accent' },
        { kind: 'path', d: star(W - 52, 16, 6), tone: 'soft' },
        { kind: 'path', d: star(W - 16, 50, 5), tone: 'soft' },
        { kind: 'path', d: star(21, H - 64, 12), tone: 'accent' },
        { kind: 'path', d: star(13, H - 92, 5), tone: 'soft' },
        { kind: 'path', d: star(26, H - 40, 5), tone: 'soft' },
      ]
    default:
      return []
  }
}

/** The colour of a shape's tone in the theme. */
export function decorationColor(theme: TemplateTheme, tone: DecorationShape['tone']): string {
  return tone === 'accent' ? theme.accent : theme.accentSoft
}
