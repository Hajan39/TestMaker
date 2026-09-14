import type { Question } from '../src/schema/question'
import type { ResolvedTestItem, Test } from '../src/schema/test'
import { BUILT_IN_TEMPLATES } from '../src/schema/builtInTemplates'
import type { Template } from '../src/schema/template'

let counter = 0
const id = (prefix: string) => `${prefix}-${(counter += 1)}`

export function makeQuestion(overrides: Partial<Question> & Pick<Question, 'type' | 'payload'>): Question {
  return {
    id: id('q'),
    topicId: 't1',
    materialId: null,
    source: 'ai',
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    points: 1,
    difficulty: 2,
    blocks: [],
    ...overrides,
  } as Question
}

export const sampleQuestions: Question[] = [
  makeQuestion({
    type: 'single_choice',
    points: 1,
    payload: {
      prompt: 'Kde probíhá výměna plynů v plicích?',
      options: ['V průdušnici', 'V plicních sklípcích', 'V hrtanu', 'V nosohltanu'],
      correctIndex: 1,
    },
    explanation: 'Plicní sklípky jsou opředeny vlásečnicemi.',
  }),
  makeQuestion({
    type: 'multi_choice',
    points: 2,
    payload: {
      prompt: 'Které orgány patří k horním cestám dýchacím?',
      options: ['Dutina nosní', 'Nosohltan', 'Průdušinky', 'Plicní sklípky'],
      correctIndices: [0, 1],
    },
  }),
  makeQuestion({
    type: 'open',
    points: 3,
    payload: { prompt: 'Popiš cestu vzduchu od nosu k plicním sklípkům.', lines: 4, answer: 'Nos → nosohltan → hrtan → průdušnice → průdušky → průdušinky → sklípky.' },
  }),
  makeQuestion({
    type: 'true_false',
    points: 2,
    payload: {
      prompt: 'Rozhodni, zda jsou tvrzení pravdivá.',
      statements: [
        { text: 'Hrtan je tvořen chrupavkami.', isTrue: true },
        { text: 'Plíce jsou sval.', isTrue: false },
      ],
    },
  }),
  makeQuestion({
    type: 'fill_blank',
    points: 2,
    payload: {
      prompt: 'Doplň chybějící výrazy.',
      text: 'Vzduch vstupuje do těla ___ a pokračuje do ___.',
      blanks: ['dutinou nosní', 'hrtanu'],
      wordBank: ['dutinou nosní', 'hrtanu', 'žaludkem'],
    },
  }),
  makeQuestion({
    type: 'matching',
    points: 3,
    payload: {
      prompt: 'Přiřaď orgán k jeho funkci.',
      left: ['Hrtan', 'Průdušnice', 'Plicní sklípky'],
      right: ['Výměna plynů', 'Tvorba hlasu', 'Vedení vzduchu'],
      pairs: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    },
  }),
  makeQuestion({
    type: 'ordering',
    points: 2,
    payload: {
      prompt: 'Seřaď části dýchací cesty podle toku vzduchu.',
      items: ['Dutina nosní', 'Hrtan', 'Průdušnice', 'Průdušky'],
    },
  }),
  makeQuestion({
    type: 'table_fill',
    points: 3,
    payload: {
      prompt: 'Doplň tabulku.',
      headers: ['Orgán', 'Funkce'],
      rows: [
        ['Hrtan', null],
        [null, 'Výměna plynů'],
      ],
      answers: ['tvorba hlasu', 'plicní sklípky'],
    },
  }),
  makeQuestion({
    type: 'short_answer',
    points: 1,
    payload: { prompt: 'Kolik laloků má pravá plíce?', answer: 'tři', acceptedAnswers: ['3'] },
    blocks: [
      {
        kind: 'table',
        caption: 'Přehled',
        rows: [
          [
            { text: 'Plíce', header: true, blank: false },
            { text: 'Laloky', header: true, blank: false },
          ],
          [
            { text: 'Pravá', header: false, blank: false },
            { text: '', header: false, blank: true },
          ],
        ],
      },
    ],
  }),
]

export function makeTest(overrides: Partial<Test> = {}): Test {
  return {
    id: 'test-1',
    title: 'Dýchací soustava',
    description: null,
    graded: true,
    templateId: 'tpl-1',
    header: {
      school: 'ZŠ Ukázková',
      subject: 'Přírodopis',
      className: '',
      teacher: '',
      date: '',
      note: '',
    },
    variants: 2,
    showKey: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeTemplate(slug = 'klasicka'): Template {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.slug === slug) ?? BUILT_IN_TEMPLATES[0]!
  return {
    id: 'tpl-1',
    name: builtIn.name,
    description: builtIn.description,
    config: builtIn.config,
    builtIn: true,
  }
}

export function makeItems(questions: Question[] = sampleQuestions): ResolvedTestItem[] {
  const items: ResolvedTestItem[] = [
    {
      id: 'item-h1',
      testId: 'test-1',
      order: 0,
      kind: 'heading',
      questionId: null,
      text: 'Část A – Stavba dýchací soustavy',
      pointsOverride: null,
    },
  ]
  questions.forEach((question, i) => {
    items.push({
      id: `item-${i}`,
      testId: 'test-1',
      order: i + 1,
      kind: 'question',
      questionId: question.id,
      text: null,
      pointsOverride: null,
      question,
    })
  })
  return items
}
