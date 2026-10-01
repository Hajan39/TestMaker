import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractOdf, extractPdf } from '../src/extract'
import { containmentSimilarity, DUPLICATE_THRESHOLD, preferredMaterial } from '../src/extract/similarity'

const SOURCES = resolve(import.meta.dirname, '../../../sources')
const hasSources = existsSync(SOURCES)

beforeAll(() => {
  globalThis.DOMParser = new JSDOM().window.DOMParser
})

describe('containmentSimilarity', () => {
  it('identical text has similarity 1', () => {
    const text = 'Plicní sklípky zajišťují výměnu plynů mezi vzduchem a krví v plicích.'
    expect(containmentSimilarity(text, text)).toBe(1)
  })

  it('unrelated topics have similarity close to zero', () => {
    const a = 'Plicní sklípky zajišťují výměnu plynů mezi vzduchem a krví v plicích.'
    const b = 'Vyvřelé horniny vznikají tuhnutím magmatu pod povrchem nebo na povrchu Země.'
    expect(containmentSimilarity(a, b)).toBeLessThan(0.1)
  })

  it('a shorter version contained in a longer one is a duplicate', () => {
    const short = 'Plicní sklípky zajišťují výměnu plynů mezi vzduchem a krví v plicích.'
    const long = `${short} Poznámky pro učitele: zdůraznit rozdíl mezi dýcháním vnějším a vnitřním.`
    expect(containmentSimilarity(short, long)).toBeGreaterThan(DUPLICATE_THRESHOLD)
  })
})

describe('preferredMaterial', () => {
  it('a presentation wins over its PDF export', () => {
    const odp = { extension: 'odp', textLength: 1000 }
    const pdf = { extension: 'pdf', textLength: 4000 }
    expect(preferredMaterial(odp, pdf)).toBe(odp)
  })

  it('with the same format the text length decides', () => {
    const shortPdf = { extension: 'pdf', textLength: 500 }
    const longPdf = { extension: 'pdf', textLength: 5000 }
    expect(preferredMaterial(shortPdf, longPdf)).toBe(longPdf)
  })
})

describe.skipIf(!hasSources)('reálná dvojice prezentace a jejího PDF', () => {
  it('recognises 6.11 Viry.odp and 6.11 Viry.pdf as the same content', async () => {
    const odp = await extractOdf(await readFile(resolve(SOURCES, 'PŘÍRODOPIS/6.ročník/6.11 Viry.odp')))
    const pdf = await extractPdf(
      new Uint8Array(await readFile(resolve(SOURCES, 'PŘÍRODOPIS/6.ročník/6.11 Viry.pdf'))),
    )
    expect(containmentSimilarity(odp.text, pdf.text)).toBeGreaterThan(DUPLICATE_THRESHOLD)
  })

  it('different topics of the same grade are not duplicates', async () => {
    const viruses = await extractOdf(await readFile(resolve(SOURCES, 'PŘÍRODOPIS/6.ročník/6.11 Viry.odp')))
    const fungi = await extractOdf(await readFile(resolve(SOURCES, 'PŘÍRODOPIS/6.ročník/6.15 Houby.odp')))
    expect(containmentSimilarity(viruses.text, fungi.text)).toBeLessThan(DUPLICATE_THRESHOLD)
  })
})
