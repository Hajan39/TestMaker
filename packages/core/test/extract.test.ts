/**
 * Extraktory běží v prohlížeči, takže test používá jsdom pro DOMParser
 * a skutečné soubory ze složky `sources/` (ta není v gitu — test se přeskočí,
 * pokud soubory chybí).
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractDocx } from '../src/extract/docx'
import { extractHtml } from '../src/extract/html'
import { extractOdf } from '../src/extract/odf'
import { processFile } from '../src/extract'

const SOURCES = resolve(import.meta.dirname, '../../../sources')
const hasSources = existsSync(SOURCES)

beforeAll(() => {
  const dom = new JSDOM()
  globalThis.DOMParser = dom.window.DOMParser
})

const file = (relative: string) => readFile(resolve(SOURCES, relative))

describe.skipIf(!hasSources)('extraktory na reálných materiálech', () => {
  it('ODP prezentace: text slidů i poznámky', async () => {
    const result = await extractOdf(await file('PŘÍRODOPIS/8. ročník/11. Dýchací soustava.odp'))
    expect(result.text).toContain('Dýchací soustava')
    expect(result.text).toContain('průdušnice')
    expect(result.text).toContain('Slide 1')
    expect(result.pageCount).toBeGreaterThan(3)
    expect(result.needsOcr).toBe(false)
  })

  it('ODT dokument', async () => {
    const result = await extractOdf(await file('PŘÍRODOPIS/6.ročník/test- Ploštěnci.odt'))
    expect(result.text.length).toBeGreaterThan(100)
    expect(result.text.toLowerCase()).toContain('ploštěn')
  })

  it('DOCX dokument', async () => {
    const result = await extractDocx(await file('ZE/ČR.docx'))
    expect(result.text.length).toBeGreaterThan(100)
  })

  it('ODT s tabulkou: buňky na řádku jsou oddělené', async () => {
    const result = await extractOdf(await file('PŘÍRODOPIS/6.ročník/test - ostnokožci.odt'))
    expect(result.text).toContain('lilijice')
    // Původní extrakce nevkládala mezi buňky žádný oddělovač — bez něj
    // nejde poznat, kde končí jedna buňka a začíná další.
    expect(result.text).toContain('| lilijice')
  })

  it('ODT: nadpisy jsou označené, model tak pozná strukturu', async () => {
    const result = await extractOdf(await file('PŘÍRODOPIS/8. ročník/Buňky a tkáně.odt'))
    expect(result.text).toContain('## Stavba buňky')
  })

  it('DOCX s tabulkou: buňky na řádku jsou oddělené', async () => {
    const result = await extractDocx(await file('PŘÍRODOPIS/6.ročník/projevy_zivota_pl (1).docx'))
    expect(result.text).toContain('dráždivost')
    expect(result.text).toMatch(/dráždivost \| /)
  })

  it('HTML stránka', async () => {
    const html = await readFile(
      resolve(SOURCES, 'PŘÍRODOPIS/9. ročník/Krystalová stavba minerálů I. - Učebna.html'),
      'utf8',
    )
    const result = extractHtml(html)
    expect(result.text.length).toBeGreaterThan(50)
    expect(result.text).not.toContain('<script')
  })
})

describe('processFile: soubor bez textu', () => {
  it('krátký .txt (< 40 znaků) se přeskočí s důvodem „prázdný text", ne jako sken', async () => {
    const file = new File(['jen pár slov'], 'prazdny.txt', { type: 'text/plain' })
    const result = await processFile(file, 'prazdny.txt')
    expect(result.status).toBe('skipped')
    expect(result.reason).toBe('prázdný text')
  })

  it('dost dlouhý .txt projde jako obvykle, needsOcr je false', async () => {
    const text = 'Dost dlouhý text, aby soubor nebyl vyhodnocený jako prázdný. '.repeat(3)
    const file = new File([text], 'dost-dlouhy.txt', { type: 'text/plain' })
    const result = await processFile(file, 'dost-dlouhy.txt')
    expect(result.status).toBe('ok')
    expect(result.material?.needsOcr).toBe(false)
  })
})
