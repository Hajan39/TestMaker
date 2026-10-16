import { describe, expect, it } from 'vitest'
import {
  completeQuestionAnswers,
  completionBrokenMessage,
  completionNoMaterialsMessage,
  mergeCompletion,
  type AnswerCompletionRequest,
  type CompletionCall,
  type CompletionResponse,
  type QuestionDraft,
} from '../src/ai'

const MODELS = [{ provider: 'google', model: 'a' } as const]
const FOUND = { foundInMaterials: true, reason: 'Stojí to v materiálu.' }
const answer = (fields: Partial<CompletionResponse>): CompletionResponse => ({ ...FOUND, ...fields })

describe('mergeCompletion', () => {
  it('short_answer: fills the answer and accepted variants, keeps the prompt', () => {
    const draft: QuestionDraft = { type: 'short_answer', payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: '', acceptedAnswers: [] } }
    const merged = mergeCompletion(
      draft,
      answer({ answer: 'oxid uhličitý', acceptedAnswers: ['CO₂', 'CO2', 'Oxid uhličitý'], explanation: 'Rostliny ho potřebují k fotosyntéze.' }),
    )
    expect(merged).toMatchObject({
      type: 'short_answer',
      payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: 'oxid uhličitý', acceptedAnswers: ['CO₂', 'CO2'] },
      explanation: 'Rostliny ho potřebují k fotosyntéze.',
    })
  })

  it("short_answer: the teacher's answer and explanation win over the model's", () => {
    const draft: QuestionDraft = {
      type: 'short_answer',
      payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: 'CO₂', acceptedAnswers: [] },
      explanation: 'Moje poznámka.',
    }
    const merged = mergeCompletion(draft, answer({ answer: 'kyslík', acceptedAnswers: ['oxid uhličitý'], explanation: 'Jiná.' }))
    expect(merged?.payload).toEqual({ prompt: 'Jaký plyn rostliny přijímají?', answer: 'CO₂', acceptedAnswers: ['oxid uhličitý'] })
    expect(merged?.explanation).toBe('Moje poznámka.')
  })

  it('open: fills an empty model answer only', () => {
    const empty = mergeCompletion({ type: 'open', payload: { prompt: 'Popiš fotosyntézu.', lines: 4, answer: '' } }, answer({ answer: 'Rostlina vyrábí cukr.' }))
    expect(empty?.payload).toEqual({ prompt: 'Popiš fotosyntézu.', lines: 4, answer: 'Rostlina vyrábí cukr.' })
    const own = mergeCompletion({ type: 'open', payload: { prompt: 'Popiš fotosyntézu.', lines: 4, answer: 'Moje.' } }, answer({ answer: 'Jiná.' }))
    expect(own?.payload).toMatchObject({ answer: 'Moje.' })
  })

  it("single_choice: keeps the teacher's options in order and adds the rest", () => {
    const draft: QuestionDraft = {
      type: 'single_choice',
      payload: { prompt: 'Kde probíhá fotosyntéza?', options: ['V kořenech', '', '', ''], correctIndex: 0 },
    }
    const merged = mergeCompletion(
      draft,
      answer({
        options: [
          { text: 'V kořenech', correct: false },
          { text: 'V chloroplastech', correct: true },
          { text: 'V cévách', correct: false },
          { text: 'V průduších', correct: false },
        ],
      }),
    )
    expect(merged?.payload).toEqual({
      prompt: 'Kde probíhá fotosyntéza?',
      options: ['V kořenech', 'V chloroplastech', 'V cévách', 'V průduších'],
      correctIndex: 1,
    })
  })

  it('single_choice: two correct options is a broken answer', () => {
    const draft: QuestionDraft = { type: 'single_choice', payload: { prompt: 'Kde probíhá fotosyntéza?', options: ['', ''], correctIndex: 0 } }
    const merged = mergeCompletion(draft, answer({ options: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }))
    expect(merged).toBeNull()
  })

  it('multi_choice: correct indices follow the merged list', () => {
    const draft: QuestionDraft = { type: 'multi_choice', payload: { prompt: 'Co patří k obojživelníkům?', options: ['žába', ''], correctIndices: [0] } }
    const merged = mergeCompletion(
      draft,
      answer({ options: [{ text: 'kapr', correct: false }, { text: 'Žába', correct: true }, { text: 'mlok', correct: true }, { text: 'zmije', correct: false }] }),
    )
    expect(merged?.payload).toEqual({ prompt: 'Co patří k obojživelníkům?', options: ['žába', 'kapr', 'mlok', 'zmije'], correctIndices: [0, 2] })
  })

  it("true_false: sets the truth of the teacher's statements without touching their text", () => {
    const draft: QuestionDraft = {
      type: 'true_false',
      payload: { prompt: 'Rozhodni.', statements: [{ text: 'Žába je obojživelník.', isTrue: false }, { text: '', isTrue: true }] },
    }
    const merged = mergeCompletion(draft, answer({ statements: [{ text: 'Žáby jsou obojživelníci.', isTrue: true }] }))
    expect(merged?.payload).toEqual({ prompt: 'Rozhodni.', statements: [{ text: 'Žába je obojživelník.', isTrue: true }] })
  })

  it('true_false: adds statements only when there are none', () => {
    const draft: QuestionDraft = { type: 'true_false', payload: { prompt: 'Rozhodni.', statements: [{ text: '', isTrue: true }] } }
    const merged = mergeCompletion(draft, answer({ statements: [{ text: 'Kapr je ryba.', isTrue: true }, { text: 'Mlok je pták.', isTrue: false }] }))
    expect(merged?.payload).toMatchObject({ statements: [{ text: 'Kapr je ryba.', isTrue: true }, { text: 'Mlok je pták.', isTrue: false }] })
  })

  it('fill_blank: fills blanks for the gaps; a wrong count is broken', () => {
    const draft: QuestionDraft = { type: 'fill_blank', payload: { prompt: 'Doplň.', text: 'Rostliny přijímají ___ a vydávají ___.', blanks: [''], wordBank: [] } }
    expect(mergeCompletion(draft, answer({ blanks: ['oxid uhličitý', 'kyslík'] }))?.payload).toMatchObject({ blanks: ['oxid uhličitý', 'kyslík'] })
    expect(mergeCompletion(draft, answer({ blanks: ['oxid uhličitý'] }))).toBeNull()
  })

  it("matching: pairs the teacher's left items with her right column, keeping its order", () => {
    const draft: QuestionDraft = {
      type: 'matching',
      payload: { prompt: 'Přiřaď.', left: ['kapr', 'žába', ''], right: ['obojživelník', 'ryba', ''], pairs: [[0, 0], [1, 1], [2, 2]] },
    }
    const merged = mergeCompletion(draft, answer({ right: ['ryba', 'Obojživelník'] }))
    expect(merged?.payload).toEqual({ prompt: 'Přiřaď.', left: ['kapr', 'žába'], right: ['obojživelník', 'ryba'], pairs: [[0, 1], [1, 0]] })
  })

  it('matching: an empty right column comes from the model', () => {
    const draft: QuestionDraft = { type: 'matching', payload: { prompt: 'Přiřaď.', left: ['kapr', 'žába'], right: ['', ''], pairs: [[0, 0], [1, 1]] } }
    const merged = mergeCompletion(draft, answer({ right: ['ryba', 'obojživelník'] }))
    expect(merged?.type).toBe('matching')
    const payload = merged!.payload as { left: string[]; right: string[]; pairs: [number, number][] }
    expect(payload.pairs.map(([l, r]) => [payload.left[l], payload.right[r]])).toEqual([
      ['kapr', 'ryba'],
      ['žába', 'obojživelník'],
    ])
  })

  it("ordering: reorders the teacher's items by the model's order without changing them", () => {
    const draft: QuestionDraft = { type: 'ordering', payload: { prompt: 'Seřaď vývoj žáby.', items: ['žába', 'vajíčko', 'pulec'] } }
    expect(mergeCompletion(draft, answer({ correctOrder: [1, 2, 0] }))?.payload).toEqual({ prompt: 'Seřaď vývoj žáby.', items: ['vajíčko', 'pulec', 'žába'] })
    expect(mergeCompletion(draft, answer({ correctOrder: [0, 0, 1] }))).toBeNull()
  })

  it('table_fill: fills answers for the empty cells', () => {
    const draft: QuestionDraft = {
      type: 'table_fill',
      payload: { prompt: 'Doplň tabulku.', headers: ['Živočich', 'Třída'], rows: [['kapr', null], ['žába', '']], answers: [] },
    }
    expect(mergeCompletion(draft, answer({ tableAnswers: ['ryby', 'obojživelníci'] }))?.payload).toEqual({
      prompt: 'Doplň tabulku.',
      headers: ['Živočich', 'Třída'],
      rows: [['kapr', null], ['žába', null]],
      answers: ['ryby', 'obojživelníci'],
    })
  })
})

describe('completeQuestionAnswers', () => {
  const draft: QuestionDraft = { type: 'short_answer', payload: { prompt: 'Jaký plyn rostliny přijímají?', answer: '', acceptedAnswers: [] } }
  const request = (overrides: Partial<AnswerCompletionRequest> = {}): AnswerCompletionRequest => ({
    draft,
    topicName: 'Fotosyntéza',
    subjectName: 'Přírodopis',
    gradeName: '6. ročník',
    materials: '=== rostliny.txt ===\nRostliny přijímají oxid uhličitý.',
    allowGeneralKnowledge: false,
    ...overrides,
  })
  const recording = (response: unknown) => {
    const prompts: string[] = []
    const callModel: CompletionCall = async ({ prompt }) => {
      prompts.push(prompt)
      return response
    }
    return { prompts, callModel }
  }

  it('step one: answer from the materials fills the question', async () => {
    const model = recording(answer({ answer: 'oxid uhličitý', acceptedAnswers: ['CO₂'] }))
    const result = await completeQuestionAnswers(request(), { models: MODELS, callModel: model.callModel })
    expect(result).toMatchObject({ status: 'filled', fromMaterials: true, question: { payload: { answer: 'oxid uhličitý', acceptedAnswers: ['CO₂'] } } })
    expect(model.prompts[0]).toContain('Vycházej výhradně z dodaných materiálů')
    expect(model.prompts[0]).toContain('Rostliny přijímají oxid uhličitý.')
  })

  it('step one: not found in the materials fills nothing', async () => {
    const model = recording({ foundInMaterials: false, reason: 'Materiály o plynech nemluví.', answer: 'oxid uhličitý' })
    const result = await completeQuestionAnswers(request(), { models: MODELS, callModel: model.callModel })
    expect(result).toEqual({ status: 'not_found', reason: 'Materiály o plynech nemluví.' })
  })

  it('step one without materials does not call the model', async () => {
    const model = recording(answer({ answer: 'x' }))
    const result = await completeQuestionAnswers(request({ materials: '  ' }), { models: MODELS, callModel: model.callModel })
    expect(result).toEqual({ status: 'not_found', reason: completionNoMaterialsMessage() })
    expect(model.prompts).toEqual([])
  })

  it('step two allows general knowledge and marks the answer as not from the materials', async () => {
    const model = recording({ foundInMaterials: false, reason: 'Z obecných znalostí.', answer: 'oxid uhličitý' })
    const result = await completeQuestionAnswers(request({ materials: '', allowGeneralKnowledge: true }), { models: MODELS, callModel: model.callModel })
    expect(result).toMatchObject({ status: 'filled', fromMaterials: false, question: { payload: { answer: 'oxid uhličitý' } } })
    expect(model.prompts[0]).toContain('učitelka souhlasila s obecnými znalostmi')
  })

  it('a broken answer throws a Czech error', async () => {
    const model = recording(answer({}))
    await expect(completeQuestionAnswers(request(), { models: MODELS, callModel: model.callModel })).rejects.toThrow(completionBrokenMessage())
  })
})
