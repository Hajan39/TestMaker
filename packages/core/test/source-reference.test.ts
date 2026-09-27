import { describe, expect, it } from 'vitest'
import { checkQuestion, REFERENCES_SOURCE } from '../src/ai/generate'
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
  it('chytí příklad z hlášení chyby (uvedeno v materiálu)', () => {
    expect(referencesSource(single('Kteří ze zástupců jsou uvedeni v materiálu?'))).toBe(true)
  })

  it('chytí "podle textu"', () => {
    expect(referencesSource(single('Podle textu, čím dýchají žáby?'))).toBe(true)
  })

  it('chytí "jak je uvedeno výše"', () => {
    expect(referencesSource(single('Jak je uvedeno výše, čím je poháněn koloběh vody?'))).toBe(true)
  })

  it('chytí odkaz v tvrzení pravda/nepravda', () => {
    expect(
      referencesSource(
        trueFalse([
          { text: 'Voda se v přírodě vypařuje.', isTrue: true },
          { text: 'V textu se píše, že led je lehčí než voda.', isTrue: true },
        ]),
      ),
    ).toBe(true)
  })

  it('chytí odkaz v možnosti výběru', () => {
    expect(referencesSource(single('Čím je poháněn koloběh vody?', ['Sluncem', 'Jak je uvedeno v materiálu', 'Větrem', 'Deštěm']))).toBe(
      true,
    )
  })

  it('nechytí běžnou otázku na materiál jako látku', () => {
    expect(referencesSource(single('Ze kterého materiálu se vyrábí sklo?', ['Písku', 'Dřeva', 'Kovu', 'Papíru']))).toBe(false)
  })

  it('nechytí "stavební materiál" jako holé podstatné jméno', () => {
    expect(referencesSource(single('Který stavební materiál se používá na základy domu?'))).toBe(false)
  })

  it('nechytí běžnou samostatnou otázku', () => {
    expect(referencesSource(single('Kteří z těchto živočichů patří mezi obojživelníky?'))).toBe(false)
  })

  // Fix round 1: "uveden… v" a "zmíněn… v" musely dřív odmítnout i běžné
  // otázky na obsah díla nebo dokumentu, ne jen na materiál k písemce.
  it('nechytí "je uveden v Ústavě" (odkaz na jiný dokument, ne na materiál)', () => {
    expect(referencesSource(single('Který rok je uveden v Ústavě jako datum přijetí?'))).toBe(false)
  })

  it('nechytí "je zmíněno v básni" (odkaz na jiné dílo, ne na materiál)', () => {
    expect(referencesSource(single('Jaké zvíře je zmíněno v básni Máj?'))).toBe(false)
  })

  it('nechytí "je uvedeno v zákoně"', () => {
    expect(referencesSource(single('Co je uvedeno v zákoně o pobytu cizinců?'))).toBe(false)
  })

  it('nechytí "uvedeny v ceníku"', () => {
    expect(referencesSource(single('Jaké ceny jsou uvedeny v ceníku od ledna?'))).toBe(false)
  })

  it('chytí "zmíněno v textu učebnice" (materiál je text)', () => {
    expect(referencesSource(single('Které město je zmíněno v textu učebnice jako hlavní?'))).toBe(true)
  })

  it('chytí "uvedeno na obrázku" bez vlastního obrázku otázky', () => {
    expect(referencesSource(single('Co je uvedeno na obrázku buňky?'))).toBe(true)
  })

  it('nechytí "na obrázku", má-li otázka vlastní obrázek', () => {
    expect(referencesSource(singleWithImage('Co je uvedeno na obrázku buňky?'))).toBe(false)
  })
})

describe('checkQuestion odmítá odkaz na materiál', () => {
  it('vrátí chybu REFERENCES_SOURCE', () => {
    const errors = checkQuestion(single('Kteří ze zástupců jsou uvedeni v materiálu?'), 'Nějaký materiál o obojživelnících.')
    expect(errors).toContain(REFERENCES_SOURCE)
  })
})

describe('readQuestionFile odmítá odkaz na materiál', () => {
  it('odmítne otázku odkazující na materiál s důvodem', () => {
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
    expect(rejected[0]?.errors).toContain(REFERENCES_SOURCE)
  })
})
