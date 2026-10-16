import { describe, expect, it } from 'vitest'
import { duplicateCheck, generateQuestions, questionSummary, type ModelCall } from '../src/ai/generate'
import { buildUserPrompt } from '../src/ai/prompts/questions'
import { AI_SETTINGS } from '../src/ai/settings'
import { contentWords, wordSimilarity } from '../src/extract/similarity'
import { questionContentSchema, type QuestionContent } from '../src/schema/question'

/**
 * Recognising a new question that only rewords one already in the topic.
 * The examples are the kind the owner reported: the model asks about the
 * same fact again with different words.
 */

const shortAnswer = (prompt: string, answer: string): QuestionContent =>
  questionContentSchema.parse({ type: 'short_answer', payload: { prompt, answer } })

const choice = (prompt: string, options: string[], correctIndex: number): QuestionContent =>
  questionContentSchema.parse({ type: 'single_choice', payload: { prompt, options, correctIndex } })

const trueFalse = (statements: [string, boolean][]): QuestionContent =>
  questionContentSchema.parse({
    type: 'true_false',
    payload: { statements: statements.map(([text, isTrue]) => ({ text, isTrue })) },
  })

const similarity = (a: QuestionContent, b: QuestionContent) =>
  wordSimilarity(contentWords(questionSummary(a)), contentWords(questionSummary(b)))

const PHOTOSYNTHESIS = shortAnswer(
  'Jak se nazývá proces, při kterém rostliny vyrábějí z oxidu uhličitého a vody cukr?',
  'fotosyntéza',
)

describe('questionSummary', () => {
  it('puts the correct answer next to the prompt and leaves distractors out', () => {
    const q = choice('Které město je hlavním městem Moravy?', ['Olomouc', 'Brno', 'Ostrava'], 1)
    expect(questionSummary(q)).toBe('Které město je hlavním městem Moravy? → Brno')
  })

  it('fills the blanks into the text', () => {
    const q = questionContentSchema.parse({
      type: 'fill_blank',
      payload: { text: 'Voda vře při ___ °C a mrzne při ___ °C.', blanks: ['100', '0'] },
    })
    expect(questionSummary(q)).toBe('Voda vře při 100 °C a mrzne při 0 °C.')
  })

  it('lists matching pairs, not the two columns', () => {
    const q = questionContentSchema.parse({
      type: 'matching',
      payload: { left: ['Praha', 'Brno'], right: ['Morava', 'Čechy'], pairs: [[0, 1], [1, 0]] },
    })
    expect(questionSummary(q)).toBe('Praha = Čechy; Brno = Morava')
  })

  it('is trimmed to the avoid list item length', () => {
    const q = shortAnswer('Proč '.repeat(80), 'odpověď')
    expect(questionSummary(q).length).toBe(AI_SETTINGS.avoidItemMaxLength + 1)
  })
})

describe('near-duplicate questions', () => {
  it('a reworded question on the same fact is a repeat', () => {
    const reworded = shortAnswer(
      'Jak nazýváme děj, kterým si rostliny z vody a oxidu uhličitého vyrábějí cukry?',
      'Fotosyntéza',
    )
    expect(similarity(PHOTOSYNTHESIS, reworded)).toBeGreaterThanOrEqual(AI_SETTINGS.similarQuestionThreshold)
    expect(duplicateCheck([questionSummary(PHOTOSYNTHESIS)])(reworded)).toBe(true)
  })

  it('the same fact asked as a different question type is a repeat', () => {
    const existing = choice('Ve kterém roce byla založena Karlova univerzita?', ['1348', '1415', '1212'], 0)
    const asked = shortAnswer('V jakém roce založil Karel IV. univerzitu v Praze?', '1348')
    expect(duplicateCheck([questionSummary(existing)])(asked)).toBe(true)
  })

  it('reworded true/false statements are a repeat', () => {
    const existing = trueFalse([
      ['Žáby patří mezi obojživelníky.', true],
      ['Kapr dýchá plícemi.', false],
      ['Ještěrka je plaz.', true],
    ])
    const reworded = trueFalse([
      ['Žába je obojživelník.', true],
      ['Kapr dýchá žábrami.', true],
      ['Ještěrky jsou plazi.', true],
    ])
    expect(duplicateCheck([questionSummary(existing)])(reworded)).toBe(true)
  })

  it('a different fact on the same topic is not a repeat', () => {
    const where = shortAnswer('Ve které části buňky probíhá fotosyntéza?', 'v chloroplastech')
    const gas = shortAnswer('Který plyn rostliny při fotosyntéze uvolňují do vzduchu?', 'kyslík')
    expect(similarity(PHOTOSYNTHESIS, where)).toBeLessThan(AI_SETTINGS.similarQuestionThreshold)
    expect(similarity(PHOTOSYNTHESIS, gas)).toBeLessThan(AI_SETTINGS.similarQuestionThreshold)
    const isDuplicate = duplicateCheck([questionSummary(PHOTOSYNTHESIS)])
    expect(isDuplicate(where)).toBe(false)
    expect(isDuplicate(gas)).toBe(false)
  })

  it('a different year is a different answer', () => {
    const founded = shortAnswer('V jakém roce byla založena Karlova univerzita v Praze?', '1348')
    const burnt = shortAnswer('V jakém roce byl upálen Jan Hus v Kostnici?', '1415')
    expect(duplicateCheck([questionSummary(founded)])(burnt)).toBe(false)
  })

  it('a repeat within the same run is caught too', () => {
    const isDuplicate = duplicateCheck([])
    expect(isDuplicate(PHOTOSYNTHESIS)).toBe(false)
    expect(
      isDuplicate(shortAnswer('Jak se jmenuje děj, při němž rostliny vyrábějí cukr z vody a oxidu uhličitého?', 'fotosyntéza')),
    ).toBe(true)
  })
})

describe('generation drops repeats and counts them separately', () => {
  const MATERIAL =
    '=== rostliny.txt ===\nRostliny vyrábějí z oxidu uhličitého a vody cukr, tomu ději se říká fotosyntéza. Fotosyntéza probíhá v chloroplastech.'

  it('a reworded question is not saved and is counted as similar, not as rejected', async () => {
    const call: ModelCall = async () => ({
      questions: [
        shortAnswer('Jak nazýváme děj, kterým si rostliny z vody a oxidu uhličitého vyrábějí cukry?', 'fotosyntéza'),
        shortAnswer('Ve které části buňky probíhá fotosyntéza?', 'v chloroplastech'),
      ],
    })
    const result = await generateQuestions(
      {
        text: MATERIAL,
        topicName: 'Rostliny',
        subjectName: 'Přírodopis',
        gradeName: '6. ročník',
        count: 2,
        types: ['short_answer'],
        difficulty: 2,
        avoid: [questionSummary(PHOTOSYNTHESIS)],
      },
      { models: [{ provider: 'google', model: 'test' }], callModel: call },
    )
    expect(result.questions.map(questionSummary)).toEqual(['Ve které části buňky probíhá fotosyntéza? → v chloroplastech'])
    expect(result.similar).toBe(1)
    expect(result.rejected).toEqual([])
  })

  it('the model sees existing questions with their answers and is told to ask about something else', () => {
    const prompt = buildUserPrompt({
      text: MATERIAL,
      topicName: 'Rostliny',
      subjectName: 'Přírodopis',
      gradeName: null,
      count: 1,
      types: ['short_answer'],
      difficulty: 2,
      avoid: [questionSummary(PHOTOSYNTHESIS)],
    })
    expect(prompt).toContain(`- ${questionSummary(PHOTOSYNTHESIS)}`)
    expect(prompt).toContain('na které se tu ještě nikdo neptá')
  })
})
