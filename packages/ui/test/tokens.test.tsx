/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8')

describe('design tokens', () => {
  it('define one brand colour and status colours', () => {
    expect(css).toContain('--color-brand: #0d7355')
    expect(css).toContain('--color-draft-bg: #fdefd6')
    expect(css).toContain('--color-danger: #b03a35')
  })

  // The progress track used to be a lightened brand green (`bg-primary/20`);
  // with "schváleno 0" a green bar lit the full width and looked like done.
  // It must be its own neutral token, in both modes.
  it('have a neutral progress track token in light and dark mode', () => {
    const light = css.slice(0, css.indexOf(':root.dark'))
    const dark = css.slice(css.indexOf(':root.dark'))
    expect(light).toMatch(/--color-track:\s*#/)
    expect(dark).toMatch(/--color-track:\s*#/)
    expect(css).not.toMatch(/--color-track:\s*(var\(--color-brand\)|#0d7355)/)

    const progress = readFileSync(resolve(import.meta.dirname, '../src/ui/progress.tsx'), 'utf8')
    expect(progress).toContain('bg-track')
    expect(progress).not.toContain('bg-primary/20')
  })

  it('define radii per the spec', () => {
    expect(css).toContain('--radius-inner: 5px')
    expect(css).toContain('--radius-outer: 8px')
    expect(css).toContain('--radius-tag: 3px')
  })

  it('do not name our green accent; that name belongs to shadcn', () => {
    const theme = css.slice(0, css.indexOf('.surface-chrome'))
    expect(theme).not.toMatch(/--color-accent:\s*#0d7355/)
  })

  it('have two emphases as classes, not as a second token set', () => {
    expect(css).toContain('.surface-chrome')
    expect(css).toContain('.surface-content')
    // Emphasis may override only text, labels and radius, not the palette.
    const chrome = css.slice(css.indexOf('.surface-chrome'))
    expect(chrome).not.toContain('--color-brand:')
  })

  it('emphases have different corner radii', () => {
    // Extract the .surface-chrome block
    const chromeStart = css.indexOf('.surface-chrome')
    const chromeEnd = css.indexOf('}', chromeStart)
    const chromeBlock = css.slice(chromeStart, chromeEnd)

    // Extract the .surface-content block
    const contentStart = css.indexOf('.surface-content')
    const contentEnd = css.indexOf('}', contentStart)
    const contentBlock = css.slice(contentStart, contentEnd)

    // Make sure chrome has 5px (the regex prevents bypassing via whitespace)
    expect(chromeBlock).toMatch(/--radius-inner:\s*5px/)

    // Make sure content has 6px (different from chrome)
    expect(contentBlock).toMatch(/--radius-inner:\s*6px/)
  })
})
