import { describe, expect, it } from 'vitest'
import {
  clueRevealsWord,
  filterEntries,
  fitMaterials,
  generatePuzzleWords,
  indexMaterial,
  isNearDuplicate,
  looksNonNominative,
  matchInMaterial,
  maxLettersFor,
  missingPhraseLetters,
  trimClue,
  wordsToRequest,
  type PuzzleWordsCall,
} from '../src/ai/puzzleWords'
import { buildPuzzleWordsPrompt, buildPuzzleWordsSystemPrompt } from '../src/ai/prompts/puzzleWords'
import { AI_SETTINGS } from '../src/ai/settings'

/**
 * Slova do hlavolamu od modelu. Model se tu nikdy nevolá doopravdy —
 * `callModel` je podvržený a vrací to, co skutečný model v auditu opravdu
 * vracel (slova bez diakritiky, vymyšlená slova, prozrazené nápovědy).
 */

const TRAVENI =
  'Potrava putuje z dutiny ústní jícnem do žaludku. Za žaludkem následuje dvanáctník, kam ústí slinivka břišní. ' +
  'Kořeny rostlin sají vodu. Ústava je základní zákon státu. Horniny obsahují křemen a živec.'

const index = indexMaterial(TRAVENI)

describe('slovo v materiálu', () => {
  it('slovo s diakritikou projde i v jiném tvaru', () => {
    expect(matchInMaterial('dvanáctník', index)).toBe('dvanáctník')
    expect(matchInMaterial('kořen', index)).toBe('kořen')
    expect(matchInMaterial('žaludek', index)).toBe('žaludek')
  })

  it('slovo bez diakritiky se opraví podle materiálu', () => {
    expect(matchInMaterial('zaludek', index)).toBe('žaludek')
    expect(matchInMaterial('jicen', index)).toBe('jícen')
    expect(matchInMaterial('kremen', index)).toBe('křemen')
    expect(matchInMaterial('dvanactnik', index)).toBe('dvanáctník')
  })

  it('diakritika koncovky delšího tvaru se do slova nepřenese', () => {
    const znaky = indexMaterial('Státní znak najdeš na bankovkách a na uniformách vojáků.')
    expect(matchInMaterial('bankovka', znaky)).toBe('bankovka')
    expect(matchInMaterial('uniforma', znaky)).toBe('uniforma')
  })

  it('velké písmeno od modelu zůstane', () => {
    expect(matchInMaterial('Ustava', index)).toBe('Ústava')
  })

  it('slovo s diakritikou, jehož tvar v materiálu stojí, se nepřepíše podle podobného slova', () => {
    const houby = indexMaterial('Pod smrkem roste hřibek i malé hříbky.')
    expect(matchInMaterial('hříbek', houby)).toBe('hříbek')
  })

  it('slovo, které v materiálu není, se nenajde', () => {
    expect(matchInMaterial('hvozdy', index)).toBeNull()
    expect(matchInMaterial('radovzmena', index)).toBeNull()
  })
})

describe('kontrola slov od modelu', () => {
  it('opraví diakritiku a vymyšlené slovo zahodí', () => {
    const { entries, rejected, adjusted } = filterEntries(
      [
        { word: 'zaludek', clue: 'Vak, ve kterém se tráví potrava.' },
        { word: 'hvozdy', clue: 'Velké hluboké lesy.' },
      ],
      { source: TRAVENI },
    )
    expect(entries).toEqual([{ word: 'žaludek', clue: 'Vak, ve kterém se tráví potrava.' }])
    expect(rejected).toEqual([{ word: 'hvozdy', reason: 'v materiálu se nenašlo' }])
    expect(adjusted[0]?.note).toContain('zaludek')
  })

  it('nápověda, která prozradí slovo nebo jeho kořen, neprojde', () => {
    expect(clueRevealsWord('kořen', 'Kořenový systém rostliny.')).toBe(true)
    expect(clueRevealsWord('žaludek', 'Zaludecni stava tráví potravu.')).toBe(true)
    expect(clueRevealsWord('žaludek', 'Vak, ve kterém se tráví potrava.')).toBe(false)
    const { rejected } = filterEntries([{ word: 'kořen', clue: 'Kořenový systém rostliny.' }], { source: TRAVENI })
    expect(rejected[0]?.reason).toBe('nápověda prozrazuje hledané slovo')
  })

  it('stejná nápověda u dvou slov: druhé se zahodí', () => {
    const { entries, rejected } = filterEntries(
      [
        { word: 'jícen', clue: 'Část trávicí soustavy.' },
        { word: 'žaludek', clue: 'část trávicí soustavy' },
      ],
      { source: TRAVENI },
    )
    expect(entries.map((e) => e.word)).toEqual(['jícen'])
    expect(rejected[0]?.reason).toBe('má stejnou nápovědu jako jiné slovo')
  })

  it('dlouhou nápovědu zkrátí na konci věty, nesmyslně krátkou zahodí', () => {
    const long = `Trubice, kterou potrava putuje do žaludku. ${'Další vysvětlení bez konce '.repeat(10)}`
    expect(trimClue(long, 60)).toBe('Trubice, kterou potrava putuje do žaludku.')
    expect(trimClue('x'.repeat(300), 200)).toMatch(/…$/)
    const { entries } = filterEntries([{ word: 'jícen', clue: long }], { source: TRAVENI, clueMax: 60 })
    expect(entries[0]?.clue).toBe('Trubice, kterou potrava putuje do žaludku.')
  })

  it('slovo ze seznamu „vyhni se" ani jeho tvar neprojde', () => {
    expect(isNearDuplicate('Ústava', 'ustava')).toBe(true)
    expect(isNearDuplicate('kořen', 'kořeny')).toBe(true)
    expect(isNearDuplicate('kořen', 'jícen')).toBe(false)
    const { entries, rejected } = filterEntries(
      [
        { word: 'kořeny', clue: 'Sají vodu z půdy.' },
        { word: 'jícen', clue: 'Trubice do trávicího vaku.' },
      ],
      { source: TRAVENI, avoid: ['Kořen'] },
    )
    expect(entries.map((e) => e.word)).toEqual(['jícen'])
    expect(rejected[0]?.reason).toBe('už v hlavolamu je')
  })

  it('dva tvary téhož slova v jedné dávce: druhý se zahodí', () => {
    const { entries } = filterEntries(
      [
        { word: 'kořen', clue: 'Saje vodu z půdy.' },
        { word: 'kořeny', clue: 'Podzemní orgány rostliny.' },
      ],
      { source: TRAVENI },
    )
    expect(entries.map((e) => e.word)).toEqual(['kořen'])
  })

  it('zjevně jiný pád než první se zahodí', () => {
    expect(looksNonNominative('bankovkách')).toBe(true)
    expect(looksNonNominative('žaludek')).toBe(false)
    const { rejected } = filterEntries([{ word: 'bankovkách', clue: 'Kde najdeš státní znak.' }], {
      source: 'Znak je na bankovkách.',
    })
    expect(rejected[0]?.reason).toBe('není v 1. pádě jednotného čísla')
  })

  it('délka slova se řídí mřížkou', () => {
    expect(maxLettersFor('wordsearch')).toBe(12)
    expect(maxLettersFor('wordsearch', { cols: 8, rows: 6 })).toBe(8)
    expect(maxLettersFor('cryptogram')).toBe(AI_SETTINGS.puzzleWords.cryptogramMaxLetters)
    const { rejected } = filterEntries([{ word: 'dvanáctník', clue: 'Začátek tenkého střeva.' }], {
      source: TRAVENI,
      maxLetters: 8,
    })
    expect(rejected[0]?.reason).toBe('je delší než 8 písmen')
  })
})

describe('tajenka', () => {
  it('chybějící písmena počítá párováním, ne hladově', () => {
    // „LES": slovo „les" pokryje kterékoli písmeno, „lov" jen L, „pes" E nebo S.
    expect(missingPhraseLetters('les', ['lov', 'les', 'pes'])).toEqual([])
    expect(missingPhraseLetters('les', ['lov'])).toEqual(['E', 'S'])
    expect(missingPhraseLetters('ŘÁD', ['rad'])).toEqual(['Ř', 'Á'])
  })

  it('o slova se žádá s rezervou nad počet chybějících písmen', () => {
    expect(wordsToRequest(12, 0)).toBe(12)
    expect(wordsToRequest(5, 14)).toBe(21)
    expect(wordsToRequest(5, 60)).toBe(AI_SETTINGS.puzzleWords.maxWordsPerCall)
  })

  it('věta tajenky a chybějící písmena jdou do promptu', async () => {
    let prompt = ''
    const call: PuzzleWordsCall = async (input) => {
      prompt = input.prompt
      return { words: [{ word: 'jicen', clue: 'Trubice do trávicího vaku.' }] }
    }
    const result = await generatePuzzleWords(
      {
        text: TRAVENI,
        topicName: 'Trávení',
        subjectName: 'Přírodopis',
        gradeName: '8. ročník',
        count: 2,
        kind: 'cryptogram',
        phrase: 'jed',
        avoid: ['dvanáctník'],
      },
      { models: [{ provider: 'google', model: 'a' }], callModel: call },
    )
    expect(prompt).toContain('„jed"')
    // „dvanáctník" už pokryje D (nebo E), chybí tedy jen dvě písmena.
    expect(prompt).toMatch(/chybí slovo: [JE], [JE]\./)
    expect(result.entries.map((e) => e.word)).toEqual(['jícen'])
    expect(result.missingLetters).toHaveLength(1)
    expect(result.warning).toContain('chybí slovo')
    expect(result.stats).toMatchObject({ returned: 1, usable: 1, dropped: 0 })
  })
})

describe('prompt', () => {
  it('uvádí ročník, věk žáka a meze nápovědy', () => {
    const system = buildPuzzleWordsSystemPrompt('6. ročník', { minLetters: 3, maxLetters: 12, clueTarget: 120, clueMax: 200 })
    expect(system).toContain('6. ročníku základní školy (11–12 let)')
    expect(system).toContain('do 120 znaků')
    expect(system).not.toContain('neomezuj')
    expect(system).toContain('žaludek')
    const prompt = buildPuzzleWordsPrompt(
      { text: 'x', topicName: 'Houby', subjectName: 'Přírodopis', gradeName: '6. ročník', count: 5, kind: 'wordsearch' },
      { count: 5, text: 'x' },
    )
    expect(prompt).toContain('6. ročník (luští žák 6. ročníku')
  })
})

describe('rozpočet materiálů', () => {
  it('krátký text jde celý', () => {
    expect(fitMaterials('=== a.txt ===\nkrátký text', 1000)).toBe('=== a.txt ===\nkrátký text')
  })

  it('každý materiál dostane místo a z dlouhého se bere i konec', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Odstavec ${i} ${'slovo '.repeat(30)}`).join('\n\n')
    const text = [`=== a-dlouhy.txt ===\n${long}`, '=== b-kratky.txt ===\nkrátký materiál s pojmem mitochondrie'].join(
      '\n\n',
    )
    const fitted = fitMaterials(text, 3000, 500)
    expect(fitted.length).toBeLessThanOrEqual(3000)
    expect(fitted).toContain('=== b-kratky.txt ===')
    expect(fitted).toContain('mitochondrie')
    expect(fitted).toContain('Odstavec 0 ')
    // Úseky se berou napříč celým textem, ne jen od začátku.
    expect(fitted).toMatch(/Odstavec (3\d|4\d) /)
  })
})
