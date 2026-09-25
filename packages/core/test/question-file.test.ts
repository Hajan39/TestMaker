import { describe, expect, it } from 'vitest'
import { buildTopicSourceFile, existingPromptsFromSource, readQuestionFile } from '../src/ai/questionFile'

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

  it('neplatný JSON vysvětlí česky', () => {
    expect(() => readQuestionFile('{nejde', ZDROJ)).toThrow(/není platný JSON/)
  })

  it('zdrojový soubor nese předmět, ročník, téma a existující otázky', () => {
    expect(ZDROJ).toContain('# Ročník: 6. ročník')
    expect(ZDROJ).toContain('=== houby.pdf ===')
    expect(existingPromptsFromSource(ZDROJ)).toEqual(['Co je podhoubí?'])
  })
})
