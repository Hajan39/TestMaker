import { describe, expect, it } from 'vitest'
import { extractPdf } from '../src/extract/pdf'
import { registerServerFonts } from '../src/pdf/node'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { TestDocument } from '../src/pdf/TestDocument'
import {
  parseQuestionSnapshot,
  resolveTestItemQuestion,
  serializeQuestionSnapshot,
  snapshotDiffersFromQuestion,
  toQuestionSnapshot,
  type ResolvedTestItem,
} from '../src/schema/test'
import type { Question } from '../src/schema/question'
import { makeQuestion, makeTemplate, makeTest } from './fixtures'

registerServerFonts()

const original: Question = makeQuestion({
  id: 'q-snimek',
  type: 'short_answer',
  points: 2,
  payload: { prompt: 'Kterým orgánem vstupuje vzduch do těla?', answer: 'Dutinou nosní', acceptedAnswers: [] },
})

/** The same question after a later edit in the bank — different prompt and answer. */
const edited: Question = makeQuestion({
  id: 'q-snimek',
  type: 'short_answer',
  points: 2,
  payload: { prompt: 'ÚPLNĚ JINÉ ZADÁNÍ', answer: 'JINÁ ODPOVĚĎ', acceptedAnswers: [] },
})

function makeItem(snapshot: string | null, live: Question | null = edited): ResolvedTestItem {
  return {
    id: 'item-1',
    testId: 'test-1',
    order: 0,
    kind: 'question',
    questionId: live?.id ?? null,
    text: null,
    pointsOverride: null,
    questionSnapshot: snapshot,
    ...resolveTestItemQuestion(snapshot, live, 'item-1'),
  }
}

async function renderScreen(items: ResolvedTestItem[]): Promise<string> {
  const buffer = await renderToBuffer(
    createElement(TestDocument, {
      test: makeTest(),
      template: makeTemplate(),
      items,
      variant: 'A' as const,
      withKey: true,
      assets: {},
    }) as never,
  )
  const { text } = await extractPdf(new Uint8Array(buffer))
  return text
}

describe('question snapshot in a test', () => {
  it('the snapshot carries only question content, not metadata', () => {
    const snapshot = toQuestionSnapshot(original)
    expect(snapshot).not.toHaveProperty('id')
    expect(snapshot).not.toHaveProperty('topicId')
    expect(snapshot).not.toHaveProperty('status')
    expect(snapshot.points).toBe(2)
    expect(snapshot.difficulty).toBe(2)
  })

  it('a broken or foreign snapshot does not parse', () => {
    expect(parseQuestionSnapshot('{tohle není JSON')).toBeNull()
    expect(parseQuestionSnapshot('{"type":"neznamy_typ"}')).toBeNull()
    expect(parseQuestionSnapshot(null)).toBeNull()
    expect(parseQuestionSnapshot('')).toBeNull()
  })

  it('detects that the live question differs from the snapshot', () => {
    const snapshot = toQuestionSnapshot(original)
    expect(snapshotDiffersFromQuestion(snapshot, original)).toBe(false)
    expect(snapshotDiffersFromQuestion(snapshot, edited)).toBe(true)
  })

  it('rendering and key use the wording from the snapshot, not from the edited question', async () => {
    const text = await renderScreen([makeItem(serializeQuestionSnapshot(original))])
    expect(text).toContain('Kterým orgánem vstupuje vzduch do těla?')
    expect(text).toContain('Dutinou nosní')
    expect(text).not.toContain('ÚPLNĚ JINÉ ZADÁNÍ')
    expect(text).not.toContain('JINÁ ODPOVĚĎ')
  })

  it('editing the question in the bank does not change an already printed PDF', async () => {
    const snapshot = serializeQuestionSnapshot(original)
    const before = await renderScreen([makeItem(snapshot, original)])
    const po = await renderScreen([makeItem(snapshot, edited)])
    expect(po).toBe(before)
  })

  it('a broken snapshot falls back to the live question', async () => {
    const item = makeItem('{"type":"short_answer","payload":')
    expect(item.question?.id).toBe(edited.id)
    expect(item.questionEdited).toBe(false)
    expect(item.questionMissing).toBe(false)
    const text = await renderScreen([item])
    expect(text).toContain('ÚPLNĚ JINÉ ZADÁNÍ')
  })

  it('a missing snapshot (older data) means the live question', () => {
    const item = makeItem(null)
    expect(item.question?.payload).toEqual(edited.payload)
  })

  it('a deleted question does not break the test — it renders from the snapshot', async () => {
    const item = makeItem(serializeQuestionSnapshot(original), null)
    expect(item.questionMissing).toBe(true)
    expect(item.questionEdited).toBe(false)
    const text = await renderScreen([item])
    expect(text).toContain('Kterým orgánem vstupuje vzduch do těla?')
  })

  it('an edited question is flagged but the snapshot is rendered', () => {
    const item = makeItem(serializeQuestionSnapshot(original))
    expect(item.questionEdited).toBe(true)
    expect(item.questionMissing).toBe(false)
  })
})
