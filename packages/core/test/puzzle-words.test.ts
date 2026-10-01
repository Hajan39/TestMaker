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
 * Puzzle words from the model. The model is never really called here —
 * `callModel` is stubbed and returns what the real model actually returned in
 * the audit (words without diacritics, made-up words, revealing clues).
 */

const DIGESTION =
  'Potrava putuje z dutiny ústní jícnem do žaludku. Za žaludkem následuje dvanáctník, kam ústí slinivka břišní. ' +
  'Kořeny rostlin sají vodu. Ústava je základní zákon státu. Horniny obsahují křemen a živec.'

const index = indexMaterial(DIGESTION)

describe('word in the material', () => {
  it('a word with diacritics matches in another form too', () => {
    expect(matchInMaterial('dvanáctník', index)).toBe('dvanáctník')
    expect(matchInMaterial('kořen', index)).toBe('kořen')
    expect(matchInMaterial('žaludek', index)).toBe('žaludek')
  })

  it('a word without diacritics is fixed from the material', () => {
    expect(matchInMaterial('zaludek', index)).toBe('žaludek')
    expect(matchInMaterial('jicen', index)).toBe('jícen')
    expect(matchInMaterial('kremen', index)).toBe('křemen')
    expect(matchInMaterial('dvanactnik', index)).toBe('dvanáctník')
  })

  it('diacritics of a longer form ending do not carry into the word', () => {
    const chars = indexMaterial('Státní znak najdeš na bankovkách a na uniformách vojáků.')
    expect(matchInMaterial('bankovka', chars)).toBe('bankovka')
    expect(matchInMaterial('uniforma', chars)).toBe('uniforma')
  })

  it("the model's capital letter stays", () => {
    expect(matchInMaterial('Ustava', index)).toBe('Ústava')
  })

  it('a word with diacritics whose form is in the material is not rewritten after a similar word', () => {
    const fungi = indexMaterial('Pod smrkem roste hřibek i malé hříbky.')
    expect(matchInMaterial('hříbek', fungi)).toBe('hříbek')
  })

  it('a word not in the material is not found', () => {
    expect(matchInMaterial('hvozdy', index)).toBeNull()
    expect(matchInMaterial('radovzmena', index)).toBeNull()
  })
})

describe('checking words from the model', () => {
  it('fixes diacritics and drops a made-up word', () => {
    const { entries, rejected, adjusted } = filterEntries(
      [
        { word: 'zaludek', clue: 'Vak, ve kterém se tráví potrava.' },
        { word: 'hvozdy', clue: 'Velké hluboké lesy.' },
      ],
      { source: DIGESTION },
    )
    expect(entries).toEqual([{ word: 'žaludek', clue: 'Vak, ve kterém se tráví potrava.' }])
    expect(rejected).toEqual([{ word: 'hvozdy', reason: 'v materiálu se nenašlo' }])
    expect(adjusted[0]?.note).toContain('zaludek')
  })

  it('a clue revealing the word or its root does not pass', () => {
    expect(clueRevealsWord('kořen', 'Kořenový systém rostliny.')).toBe(true)
    expect(clueRevealsWord('žaludek', 'Zaludecni stava tráví potravu.')).toBe(true)
    expect(clueRevealsWord('žaludek', 'Vak, ve kterém se tráví potrava.')).toBe(false)
    const { rejected } = filterEntries([{ word: 'kořen', clue: 'Kořenový systém rostliny.' }], { source: DIGESTION })
    expect(rejected[0]?.reason).toBe('nápověda prozrazuje hledané slovo')
  })

  it('the same clue for two words: the second is dropped', () => {
    const { entries, rejected } = filterEntries(
      [
        { word: 'jícen', clue: 'Část trávicí soustavy.' },
        { word: 'žaludek', clue: 'část trávicí soustavy' },
      ],
      { source: DIGESTION },
    )
    expect(entries.map((e) => e.word)).toEqual(['jícen'])
    expect(rejected[0]?.reason).toBe('má stejnou nápovědu jako jiné slovo')
  })

  it('shortens a long clue at a sentence end, drops a nonsensically short one', () => {
    const long = `Trubice, kterou potrava putuje do žaludku. ${'Další vysvětlení bez konce '.repeat(10)}`
    expect(trimClue(long, 60)).toBe('Trubice, kterou potrava putuje do žaludku.')
    expect(trimClue('x'.repeat(300), 200)).toMatch(/…$/)
    const { entries } = filterEntries([{ word: 'jícen', clue: long }], { source: DIGESTION, clueMax: 60 })
    expect(entries[0]?.clue).toBe('Trubice, kterou potrava putuje do žaludku.')
  })

  it('a word from the avoid list or its form does not pass', () => {
    expect(isNearDuplicate('Ústava', 'ustava')).toBe(true)
    expect(isNearDuplicate('kořen', 'kořeny')).toBe(true)
    expect(isNearDuplicate('kořen', 'jícen')).toBe(false)
    const { entries, rejected } = filterEntries(
      [
        { word: 'kořeny', clue: 'Sají vodu z půdy.' },
        { word: 'jícen', clue: 'Trubice do trávicího vaku.' },
      ],
      { source: DIGESTION, avoid: ['Kořen'] },
    )
    expect(entries.map((e) => e.word)).toEqual(['jícen'])
    expect(rejected[0]?.reason).toBe('už v hlavolamu je')
  })

  it('two forms of the same word in one batch: the second is dropped', () => {
    const { entries } = filterEntries(
      [
        { word: 'kořen', clue: 'Saje vodu z půdy.' },
        { word: 'kořeny', clue: 'Podzemní orgány rostliny.' },
      ],
      { source: DIGESTION },
    )
    expect(entries.map((e) => e.word)).toEqual(['kořen'])
  })

  it('an obviously non-nominative case is dropped', () => {
    expect(looksNonNominative('bankovkách')).toBe(true)
    expect(looksNonNominative('žaludek')).toBe(false)
    const { rejected } = filterEntries([{ word: 'bankovkách', clue: 'Kde najdeš státní znak.' }], {
      source: 'Znak je na bankovkách.',
    })
    expect(rejected[0]?.reason).toBe('není v 1. pádě jednotného čísla')
  })

  it('word length follows the grid', () => {
    expect(maxLettersFor('wordsearch')).toBe(12)
    expect(maxLettersFor('wordsearch', { cols: 8, rows: 6 })).toBe(8)
    expect(maxLettersFor('cryptogram')).toBe(AI_SETTINGS.puzzleWords.cryptogramMaxLetters)
    const { rejected } = filterEntries([{ word: 'dvanáctník', clue: 'Začátek tenkého střeva.' }], {
      source: DIGESTION,
      maxLetters: 8,
    })
    expect(rejected[0]?.reason).toBe('je delší než 8 písmen')
  })
})

describe('cryptogram', () => {
  it('counts missing letters by matching, not greedily', () => {
    // "LES": the word "les" covers any letter, "lov" only L, "pes" E or S.
    expect(missingPhraseLetters('les', ['lov', 'les', 'pes'])).toEqual([])
    expect(missingPhraseLetters('les', ['lov'])).toEqual(['E', 'S'])
    expect(missingPhraseLetters('ŘÁD', ['rad'])).toEqual(['Ř', 'Á'])
  })

  it('asks for words with a margin above the number of missing letters', () => {
    expect(wordsToRequest(12, 0)).toBe(12)
    expect(wordsToRequest(5, 14)).toBe(21)
    expect(wordsToRequest(5, 60)).toBe(AI_SETTINGS.puzzleWords.maxWordsPerCall)
  })

  it('the cryptogram phrase and missing letters go into the prompt', async () => {
    let prompt = ''
    const call: PuzzleWordsCall = async (input) => {
      prompt = input.prompt
      return { words: [{ word: 'jicen', clue: 'Trubice do trávicího vaku.' }] }
    }
    const result = await generatePuzzleWords(
      {
        text: DIGESTION,
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
    // "dvanáctník" already covers D (or E), so only two letters are missing.
    expect(prompt).toMatch(/chybí slovo: [JE], [JE]\./)
    expect(result.entries.map((e) => e.word)).toEqual(['jícen'])
    expect(result.missingLetters).toHaveLength(1)
    expect(result.warning).toContain('chybí slovo')
    expect(result.stats).toMatchObject({ returned: 1, usable: 1, dropped: 0 })
  })
})

describe('prompt', () => {
  it('states the grade, pupil age and clue limits', () => {
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

describe('material budget', () => {
  it('a short text goes in whole', () => {
    expect(fitMaterials('=== a.txt ===\nkrátký text', 1000)).toBe('=== a.txt ===\nkrátký text')
  })

  it('every material gets room and the end of a long one is taken too', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Odstavec ${i} ${'slovo '.repeat(30)}`).join('\n\n')
    const text = [`=== a-dlouhy.txt ===\n${long}`, '=== b-kratky.txt ===\nkrátký materiál s pojmem mitochondrie'].join(
      '\n\n',
    )
    const fitted = fitMaterials(text, 3000, 500)
    expect(fitted.length).toBeLessThanOrEqual(3000)
    expect(fitted).toContain('=== b-kratky.txt ===')
    expect(fitted).toContain('mitochondrie')
    expect(fitted).toContain('Odstavec 0 ')
    // Sections are taken across the whole text, not just from the start.
    expect(fitted).toMatch(/Odstavec (3\d|4\d) /)
  })
})
