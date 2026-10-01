import { describe, expect, it } from 'vitest'
import { checkQuestion, referencesSourceMessage } from '../src/ai/generate'
import { referencesSource } from '../src/ai/sourceReference'
import { readQuestionFile } from '../src/ai/questionFile'
import type { QuestionContent } from '../src/schema/question'

const single = (prompt: string, options: string[] = ['A', 'B', 'C', 'D']): QuestionContent => ({
  type: 'single_choice',
  payload: { prompt, options, correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
})

const trueFalse = (statements: { text: string; isTrue: boolean }[]): QuestionContent => ({
  type: 'true_false',
  payload: { prompt: 'Rozhodni, zda jsou tvrzení pravdivá.', statements },
  blocks: [],
  points: 1,
  difficulty: 2,
})

const singleWithImage = (prompt: string, options: string[] = ['A', 'B', 'C', 'D']): QuestionContent => ({
  type: 'single_choice',
  payload: { prompt, options, correctIndex: 0 },
  blocks: [{ kind: 'image', assetId: 'bunka.png', widthPercent: 100 }],
  points: 1,
  difficulty: 2,
})

describe('referencesSource', () => {
  it('catches the example from the bug report (uvedeno v materiálu)', () => {
    expect(referencesSource(single('Kteří ze zástupců jsou uvedeni v materiálu?'))).toBe(true)
  })

  it('catches "podle textu"', () => {
    expect(referencesSource(single('Podle textu, čím dýchají žáby?'))).toBe(true)
  })

  it('catches "jak je uvedeno výše"', () => {
    expect(referencesSource(single('Jak je uvedeno výše, čím je poháněn koloběh vody?'))).toBe(true)
  })

  it('catches a reference in a true/false statement', () => {
    expect(
      referencesSource(
        trueFalse([
          { text: 'Voda se v přírodě vypařuje.', isTrue: true },
          { text: 'V textu se píše, že led je lehčí než voda.', isTrue: true },
        ]),
      ),
    ).toBe(true)
  })

  it('catches a reference in a choice option', () => {
    expect(referencesSource(single('Čím je poháněn koloběh vody?', ['Sluncem', 'Jak je uvedeno v materiálu', 'Větrem', 'Deštěm']))).toBe(
      true,
    )
  })

  it('does not catch an ordinary question about material as a substance', () => {
    expect(referencesSource(single('Ze kterého materiálu se vyrábí sklo?', ['Písku', 'Dřeva', 'Kovu', 'Papíru']))).toBe(false)
  })

  it('does not catch "stavební materiál" as a bare noun', () => {
    expect(referencesSource(single('Který stavební materiál se používá na základy domu?'))).toBe(false)
  })

  it('does not catch an ordinary self-contained question', () => {
    expect(referencesSource(single('Kteří z těchto živočichů patří mezi obojživelníky?'))).toBe(false)
  })

  // Fix round 1: "uveden… v" and "zmíněn… v" used to reject ordinary questions
  // about the content of a work or document too, not just about the test material.
  it('does not catch "je uveden v Ústavě" (a reference to another document, not the material)', () => {
    expect(referencesSource(single('Který rok je uveden v Ústavě jako datum přijetí?'))).toBe(false)
  })

  it('does not catch "je zmíněno v básni" (a reference to another work, not the material)', () => {
    expect(referencesSource(single('Jaké zvíře je zmíněno v básni Máj?'))).toBe(false)
  })

  it('does not catch "je uvedeno v zákoně"', () => {
    expect(referencesSource(single('Co je uvedeno v zákoně o pobytu cizinců?'))).toBe(false)
  })

  it('does not catch "uvedeny v ceníku"', () => {
    expect(referencesSource(single('Jaké ceny jsou uvedeny v ceníku od ledna?'))).toBe(false)
  })

  it('catches "zmíněno v textu učebnice" (the material is text)', () => {
    expect(referencesSource(single('Které město je zmíněno v textu učebnice jako hlavní?'))).toBe(true)
  })

  it('catches "uvedeno na obrázku" without the question\'s own image', () => {
    expect(referencesSource(single('Co je uvedeno na obrázku buňky?'))).toBe(true)
  })

  it('does not catch "na obrázku" when the question has its own image', () => {
    expect(referencesSource(singleWithImage('Co je uvedeno na obrázku buňky?'))).toBe(false)
  })
})

describe('checkQuestion rejects a reference to the material', () => {
  it('returns the referencesSource error', () => {
    const errors = checkQuestion(single('Kteří ze zástupců jsou uvedeni v materiálu?'), 'Nějaký materiál o obojživelnících.')
    expect(errors).toContain(referencesSourceMessage())
  })
})

describe('readQuestionFile rejects a reference to the material', () => {
  it('rejects a question referring to the material with a reason', () => {
    const source = '=== zvirata.pdf ===\nObojživelníci žijí ve vodě i na souši.'
    const { questions, rejected } = readQuestionFile(
      JSON.stringify([
        {
          type: 'single_choice',
          payload: {
            prompt: 'Kteří ze zástupců jsou uvedeni v materiálu?',
            options: ['Žáby', 'Ptáci', 'Ryby', 'Hmyz'],
            correctIndex: 0,
          },
        },
      ]),
      source,
    )
    expect(questions).toHaveLength(0)
    expect(rejected[0]?.errors).toContain(referencesSourceMessage())
  })
})
