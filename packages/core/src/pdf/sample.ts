import type { Question } from '../schema/question'
import type { Template } from '../schema/template'
import type { RenderableTest, ResolvedTestItem, Test } from '../schema/test'

/** Ukázkový obsah pro náhled šablony — pokrývá typy, které se vizuálně nejvíc liší. */
const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'sample-1',
    topicId: null,
    materialId: null,
    source: 'ai',
    status: 'approved',
    variantOf: null,
    createdAt: '',
    type: 'single_choice',
    payload: {
      prompt: 'Kde probíhá výměna dýchacích plynů?',
      options: ['V průdušnici', 'V plicních sklípcích', 'V hrtanu', 'V nosohltanu'],
      correctIndex: 1,
    },
    points: 1,
    difficulty: 2,
    blocks: [],
    explanation: 'Sklípky jsou opředeny vlásečnicemi.',
  },
  {
    id: 'sample-2',
    topicId: null,
    materialId: null,
    source: 'ai',
    status: 'approved',
    variantOf: null,
    createdAt: '',
    type: 'open',
    payload: {
      prompt: 'Popiš cestu vzduchu od nosu až k plicním sklípkům.',
      lines: 3,
      answer: 'Dutina nosní, nosohltan, hrtan, průdušnice, průdušky, průdušinky, plicní sklípky.',
    },
    points: 3,
    difficulty: 3,
    blocks: [],
  },
  {
    id: 'sample-draw',
    topicId: null,
    materialId: null,
    source: 'manual',
    status: 'approved',
    variantOf: null,
    createdAt: '',
    type: 'draw',
    payload: {
      prompt: 'Nakresli rostlinnou buňku a popiš její hlavní části.',
      lines: 8,
      answer: 'Buněčná stěna, cytoplazmatická membrána, jádro, chloroplasty, vakuola.',
    },
    points: 3,
    difficulty: 2,
    blocks: [],
  },
  {
    id: 'sample-3',
    topicId: null,
    materialId: null,
    source: 'ai',
    status: 'approved',
    variantOf: null,
    createdAt: '',
    type: 'true_false',
    payload: {
      prompt: 'Rozhodni, zda jsou tvrzení pravdivá.',
      statements: [
        { text: 'Hrtan je tvořen chrupavkami.', isTrue: true },
        { text: 'Plíce jsou sval.', isTrue: false },
      ],
    },
    points: 2,
    difficulty: 1,
    blocks: [],
  },
  {
    id: 'sample-4',
    topicId: null,
    materialId: null,
    source: 'ai',
    status: 'approved',
    variantOf: null,
    createdAt: '',
    type: 'matching',
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
    points: 3,
    difficulty: 2,
    blocks: [],
  },
]

const SAMPLE_TEST: Test = {
  id: 'sample',
  // Ukázka pro náhled šablony nepatří nikomu; hodnoty jsou jen výplň typu.
  ownerId: 'sample',
  visibility: 'soukrome',
  kind: 'pisemka',
  topicId: null,
  brief: null,
  title: 'Dýchací soustava',
  description: null,
  graded: true,
  templateId: 'sample',
  gradeId: null,
  header: {
    school: 'ZŠ Ukázková',
    subject: 'Přírodopis',
    className: '',
    teacher: '',
    date: '',
    note: '',
  },
  variants: 1,
  showKey: false,
  createdAt: '',
  updatedAt: '',
}

/** Náhled šablony: stejný obsah vykreslený jejím nastavením. */
export function sampleRenderableTest(template: Template, graded = true): RenderableTest {
  const items: ResolvedTestItem[] = [
    {
      id: 'sample-heading',
      testId: 'sample',
      order: 0,
      kind: 'heading',
      questionId: null,
      text: 'Část A – Stavba a funkce',
      pointsOverride: null,
    },
    ...SAMPLE_QUESTIONS.map((question, index) => ({
      id: `sample-item-${index}`,
      testId: 'sample',
      order: index + 1,
      kind: 'question' as const,
      questionId: question.id,
      text: null,
      pointsOverride: null,
      question,
    })),
  ]

  return {
    test: { ...SAMPLE_TEST, graded, templateId: template.id },
    template,
    items,
    variant: 'A',
    withKey: false,
    assets: {},
  }
}
