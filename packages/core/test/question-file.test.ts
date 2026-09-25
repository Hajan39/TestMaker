import { describe, expect, it } from 'vitest'
import {
  QuestionFileError,
  buildTopicSourceFile,
  existingPromptsFromSource,
  materialFromSource,
  readQuestionFile,
} from '../src/ai/questionFile'

const ZDROJ = buildTopicSourceFile({
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  topicName: 'Houby',
  text: '=== houby.pdf ===\nHouby nemají chlorofyl.\nPlodnice hřibu roste nad zemí.',
  existing: ['Co je podhoubí?'],
})

const otazka = (prompt: string, quote?: string) => ({
  type: 'short_answer',
  payload: { prompt, answer: 'chlorofyl' },
  ...(quote ? { evidence: { fileName: 'houby.pdf', quote } } : {}),
})

describe('soubor s otázkami z Claude Code', () => {
  it('přijme objekt s polem questions i holé pole', () => {
    const q = [otazka('Co houbám chybí?', 'Houby nemají chlorofyl.')]
    expect(readQuestionFile(JSON.stringify({ questions: q }), ZDROJ).questions).toHaveLength(1)
    expect(readQuestionFile(JSON.stringify(q), ZDROJ).questions).toHaveLength(1)
  })

  it('smí obsahovat i typy, které aplikace sama negeneruje', () => {
    const matching = {
      type: 'matching',
      payload: { left: ['hřib', 'muchomůrka'], right: ['jedlý', 'jedovatá'], pairs: [[0, 0], [1, 1]] },
    }
    expect(readQuestionFile(JSON.stringify([matching]), ZDROJ).questions).toHaveLength(1)
  })

  it('odmítne otázku s vymyšlenou citací, špatným tvarem, duplicitou a už existující otázku', () => {
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([
        otazka('Co houbám chybí?', 'Houby nemají chlorofyl.'),
        otazka('Kde roste hřib?', 'Hřib roste jen v jehličnatém lese.'),
        { type: 'short_answer', payload: {} },
        otazka('co houbám chybí'),
        otazka('Co je podhoubí?'),
      ]),
      ZDROJ,
      existingPromptsFromSource(ZDROJ),
    )
    expect(questions).toHaveLength(1)
    expect(rejected.map((r) => r.index)).toEqual([1, 2, 3, 4])
  })

  it('neplatný JSON vysvětlí česky a označí chybou souboru, ne obecnou', () => {
    expect(() => readQuestionFile('{nejde', ZDROJ)).toThrow(/není platný JSON/)
    expect(() => readQuestionFile('{nejde', ZDROJ)).toThrow(QuestionFileError)
  })

  it('chybějící seznam otázek je taky chyba souboru', () => {
    expect(() => readQuestionFile('{}', ZDROJ)).toThrow(QuestionFileError)
  })

  it('zdrojový soubor nese předmět, ročník, téma a existující otázky', () => {
    expect(ZDROJ).toContain('# Ročník: 6. ročník')
    expect(ZDROJ).toContain('=== houby.pdf ===')
    expect(existingPromptsFromSource(ZDROJ)).toEqual(['Co je podhoubí?'])
  })
})

describe('materiál ze staženého souboru', () => {
  it('odřízne hlavičku a nechá přesně text materiálů', () => {
    expect(materialFromSource(ZDROJ)).toBe('=== houby.pdf ===\nHouby nemají chlorofyl.\nPlodnice hřibu roste nad zemí.')
  })

  it('soubor bez hlavičky nechá beze změny', () => {
    const text = '=== voda.pdf ===\nVoda se v přírodě pohybuje.'
    expect(materialFromSource(text)).toBe(text)
  })

  it('citace z hlavičky neprojde — kontrola vidí jen materiál jako při nahrání', () => {
    const zHlavicky = otazka('Kterému tématu otázka patří?', 'Předmět: Přírodopis')
    const { rejected } = readQuestionFile(JSON.stringify([zHlavicky]), materialFromSource(ZDROJ))
    expect(rejected).toHaveLength(1)
  })
})

describe('duplicity výběru z možností v souboru', () => {
  it('dvě otázky se stejným obecným zadáním a jinými možnostmi ponechá obě', () => {
    const vyber = (options: string[]) => ({
      type: 'single_choice',
      payload: { prompt: 'Vyber správnou možnost.', options, correctIndex: 0 },
    })
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([vyber(['hřib', 'muchomůrka', 'bedla', 'liška']), vyber(['podhoubí', 'plodnice', 'výtrus', 'klobouk'])]),
      ZDROJ,
    )
    expect(rejected).toEqual([])
    expect(questions).toHaveLength(2)
  })
})
