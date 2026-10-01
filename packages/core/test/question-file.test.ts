import { describe, expect, it } from 'vitest'
import {
  QuestionFileError,
  buildQuestionRules,
  buildTopicSourceFile,
  existingPromptsFromSource,
  materialFromSource,
  readQuestionFile,
  schoolRulesFromSource,
} from '../src/ai/questionFile'

const SOURCE = buildTopicSourceFile({
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  topicName: 'Houby',
  text: '=== houby.pdf ===\nHouby nemají chlorofyl.\nPlodnice hřibu roste nad zemí.',
  existing: ['Co je podhoubí?'],
})

const question = (prompt: string, quote?: string) => ({
  type: 'short_answer',
  payload: { prompt, answer: 'chlorofyl' },
  ...(quote ? { evidence: { fileName: 'houby.pdf', quote } } : {}),
})

describe('question file from Claude Code', () => {
  it('accepts an object with a questions array and a bare array', () => {
    const q = [question('Co houbám chybí?', 'Houby nemají chlorofyl.')]
    expect(readQuestionFile(JSON.stringify({ questions: q }), SOURCE).questions).toHaveLength(1)
    expect(readQuestionFile(JSON.stringify(q), SOURCE).questions).toHaveLength(1)
  })

  it('may contain types the app does not generate itself', () => {
    const matching = {
      type: 'matching',
      payload: { left: ['hřib', 'muchomůrka'], right: ['jedlý', 'jedovatá'], pairs: [[0, 0], [1, 1]] },
    }
    expect(readQuestionFile(JSON.stringify([matching]), SOURCE).questions).toHaveLength(1)
  })

  it('rejects a question with a made-up quote, a bad shape, a duplicate and an already existing question', () => {
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([
        question('Co houbám chybí?', 'Houby nemají chlorofyl.'),
        question('Kde roste hřib?', 'Hřib roste jen v jehličnatém lese.'),
        { type: 'short_answer', payload: {} },
        question('co houbám chybí'),
        question('Co je podhoubí?'),
      ]),
      SOURCE,
      existingPromptsFromSource(SOURCE),
    )
    expect(questions).toHaveLength(1)
    expect(rejected.map((r) => r.index)).toEqual([1, 2, 3, 4])
  })

  it('explains invalid JSON in Czech and marks it as a file error, not a generic one', () => {
    expect(() => readQuestionFile('{nejde', SOURCE)).toThrow(/není platný JSON/)
    expect(() => readQuestionFile('{nejde', SOURCE)).toThrow(QuestionFileError)
  })

  it('a missing question list is a file error too', () => {
    expect(() => readQuestionFile('{}', SOURCE)).toThrow(QuestionFileError)
  })

  it('the source file carries subject, grade, topic and existing questions', () => {
    expect(SOURCE).toContain('# Ročník: 6. ročník')
    expect(SOURCE).toContain('=== houby.pdf ===')
    expect(existingPromptsFromSource(SOURCE)).toEqual(['Co je podhoubí?'])
  })

  it('without school rules it adds no header', () => {
    expect(SOURCE).not.toContain('# Pravidla školy:')
    expect(schoolRulesFromSource(SOURCE)).toEqual([])
  })

  it('active school rules go into the downloaded file header so Claude Code follows them too', () => {
    const withRules = buildTopicSourceFile({
      subjectName: 'Přírodopis',
      gradeName: '6. ročník',
      topicName: 'Houby',
      text: '=== houby.pdf ===\nHouby nemají chlorofyl.',
      existing: [],
      schoolRules: ['Nepoužívej otázky ano/ne.', 'Piš kratší zadání.'],
    })
    expect(withRules).toContain('# Pravidla školy:')
    expect(schoolRulesFromSource(withRules)).toEqual(['Nepoužívej otázky ano/ne.', 'Piš kratší zadání.'])
    // The header can still be cut off — the material stays text only.
    expect(materialFromSource(withRules)).toBe('=== houby.pdf ===\nHouby nemají chlorofyl.')
  })
})

describe('rules for Claude Code (/otazky)', () => {
  it('without school rules it contains only the general rules — the script has no database', () => {
    const rules = buildQuestionRules('6. ročník')
    expect(rules).not.toContain('Pravidla této školy')
  })

  it('with school rules it appends them (to test buildSystemPrompt with the extra parameter)', () => {
    const rules = buildQuestionRules('6. ročník', ['Piš kratší zadání.'])
    expect(rules).toContain('Pravidla této školy:')
    expect(rules).toContain('- Piš kratší zadání.')
  })
})

describe('material from the downloaded file', () => {
  it('cuts off the header and keeps exactly the material text', () => {
    expect(materialFromSource(SOURCE)).toBe('=== houby.pdf ===\nHouby nemají chlorofyl.\nPlodnice hřibu roste nad zemí.')
  })

  it('leaves a file without a header unchanged', () => {
    const text = '=== voda.pdf ===\nVoda se v přírodě pohybuje.'
    expect(materialFromSource(text)).toBe(text)
  })

  it('a quote from the header does not pass — the check sees only the material, as on upload', () => {
    const fromHeader = question('Kterému tématu otázka patří?', 'Předmět: Přírodopis')
    const { rejected } = readQuestionFile(JSON.stringify([fromHeader]), materialFromSource(SOURCE))
    expect(rejected).toHaveLength(1)
  })
})

describe('choice question duplicates in the file', () => {
  it('keeps both of two questions with the same generic prompt and different options', () => {
    const selection = (options: string[]) => ({
      type: 'single_choice',
      payload: { prompt: 'Vyber správnou možnost.', options, correctIndex: 0 },
    })
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([selection(['hřib', 'muchomůrka', 'bedla', 'liška']), selection(['podhoubí', 'plodnice', 'výtrus', 'klobouk'])]),
      SOURCE,
    )
    expect(rejected).toEqual([])
    expect(questions).toHaveLength(2)
  })
})
