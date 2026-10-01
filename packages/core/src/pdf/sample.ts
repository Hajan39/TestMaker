import { t } from '../i18n'
import type { Question } from '../schema/question'
import type { Template } from '../schema/template'
import type { RenderableTest, ResolvedTestItem, Test } from '../schema/test'

/** Sample content for the template preview — covers the visually most distinct types. */
const sampleQuestions = (): Question[] => [
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
      prompt: t('pdf:sample.choice.prompt'),
      options: [
        t('pdf:sample.choice.option1'),
        t('pdf:sample.choice.option2'),
        t('pdf:sample.choice.option3'),
        t('pdf:sample.choice.option4'),
      ],
      correctIndex: 1,
    },
    points: 1,
    difficulty: 2,
    blocks: [],
    explanation: t('pdf:sample.choice.explanation'),
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
      prompt: t('pdf:sample.open.prompt'),
      lines: 3,
      answer: t('pdf:sample.open.answer'),
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
      prompt: t('pdf:sample.draw.prompt'),
      lines: 8,
      answer: t('pdf:sample.draw.answer'),
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
      prompt: t('pdf:sample.trueFalse.prompt'),
      statements: [
        { text: t('pdf:sample.trueFalse.statement1'), isTrue: true },
        { text: t('pdf:sample.trueFalse.statement2'), isTrue: false },
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
      prompt: t('pdf:sample.matching.prompt'),
      left: [t('pdf:sample.matching.left1'), t('pdf:sample.matching.left2'), t('pdf:sample.matching.left3')],
      right: [t('pdf:sample.matching.right1'), t('pdf:sample.matching.right2'), t('pdf:sample.matching.right3')],
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

const sampleTest = (): Test => ({
  id: 'sample',
  // The template preview sample belongs to nobody; these values only satisfy the type.
  ownerId: 'sample',
  visibility: 'soukrome',
  kind: 'pisemka',
  topicId: null,
  brief: null,
  title: t('pdf:sample.title'),
  description: null,
  graded: true,
  templateId: 'sample',
  gradeId: null,
  header: {
    school: t('pdf:sample.school'),
    subject: t('pdf:sample.subject'),
    className: '',
    teacher: '',
    date: '',
    note: '',
  },
  variants: 1,
  showKey: false,
  createdAt: '',
  updatedAt: '',
})

/** Template preview: the same content rendered with its settings. */
export function sampleRenderableTest(template: Template, graded = true): RenderableTest {
  const items: ResolvedTestItem[] = [
    {
      id: 'sample-heading',
      testId: 'sample',
      order: 0,
      kind: 'heading',
      questionId: null,
      text: t('pdf:sample.heading'),
      pointsOverride: null,
    },
    ...sampleQuestions().map((question, index) => ({
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
    test: { ...sampleTest(), graded, templateId: template.id },
    template,
    items,
    variant: 'A',
    withKey: false,
    assets: {},
  }
}
