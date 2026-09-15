/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8')

describe('design tokeny', () => {
  it('definují jednu akcentní barvu a stavové barvy', () => {
    expect(css).toContain('--color-brand: #0d7355')
    expect(css).toContain('--color-draft-bg: #fdefd6')
    expect(css).toContain('--color-danger: #b03a35')
  })

  it('definují poloměry podle specifikace', () => {
    expect(css).toContain('--radius-inner: 5px')
    expect(css).toContain('--radius-outer: 8px')
    expect(css).toContain('--radius-tag: 3px')
  })

  it('nepojmenují naši zelenou jako accent, to jméno patří shadcn', () => {
    const theme = css.slice(0, css.indexOf('.surface-chrome'))
    expect(theme).not.toMatch(/--color-accent:\s*#0d7355/)
  })

  it('mají dva důrazy jako třídy, ne jako druhou sadu tokenů', () => {
    expect(css).toContain('.surface-chrome')
    expect(css).toContain('.surface-content')
    // Důraz smí přepisovat jen text, popisky a poloměr, ne paletu.
    const chrome = css.slice(css.indexOf('.surface-chrome'))
    expect(chrome).not.toContain('--color-brand:')
  })

  it('důrazy mají různé poloměry rohů', () => {
    // Extrahuj .surface-chrome blok
    const chromeStart = css.indexOf('.surface-chrome')
    const chromeEnd = css.indexOf('}', chromeStart)
    const chromeBlock = css.slice(chromeStart, chromeEnd)

    // Extrahuj .surface-content blok
    const contentStart = css.indexOf('.surface-content')
    const contentEnd = css.indexOf('}', contentStart)
    const contentBlock = css.slice(contentStart, contentEnd)

    // Ujisti se, že chrome má 5px (regex zabranuje obejití mezerou)
    expect(chromeBlock).toMatch(/--radius-inner:\s*5px/)

    // Ujisti se, že content má 6px (různé od chrome)
    expect(contentBlock).toMatch(/--radius-inner:\s*6px/)
  })
})
