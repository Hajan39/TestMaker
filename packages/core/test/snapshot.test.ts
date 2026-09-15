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

const puvodni: Question = makeQuestion({
  id: 'q-snimek',
  type: 'short_answer',
  points: 2,
  payload: { prompt: 'Kterým orgánem vstupuje vzduch do těla?', answer: 'Dutinou nosní', acceptedAnswers: [] },
})

/** Táž otázka po pozdější úpravě v bance — jiné zadání i jiná odpověď. */
const upravena: Question = makeQuestion({
  id: 'q-snimek',
  type: 'short_answer',
  points: 2,
  payload: { prompt: 'ÚPLNĚ JINÉ ZADÁNÍ', answer: 'JINÁ ODPOVĚĎ', acceptedAnswers: [] },
})

function polozka(snapshot: string | null, live: Question | null = upravena): ResolvedTestItem {
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

async function vykresli(items: ResolvedTestItem[]): Promise<string> {
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

describe('snímek otázky v testu', () => {
  it('snímek nese jen obsah otázky, ne metadata', () => {
    const snapshot = toQuestionSnapshot(puvodni)
    expect(snapshot).not.toHaveProperty('id')
    expect(snapshot).not.toHaveProperty('topicId')
    expect(snapshot).not.toHaveProperty('status')
    expect(snapshot.points).toBe(2)
    expect(snapshot.difficulty).toBe(2)
  })

  it('poškozený nebo cizí snímek se neparsuje', () => {
    expect(parseQuestionSnapshot('{tohle není JSON')).toBeNull()
    expect(parseQuestionSnapshot('{"type":"neznamy_typ"}')).toBeNull()
    expect(parseQuestionSnapshot(null)).toBeNull()
    expect(parseQuestionSnapshot('')).toBeNull()
  })

  it('pozná, že se živá otázka od snímku liší', () => {
    const snapshot = toQuestionSnapshot(puvodni)
    expect(snapshotDiffersFromQuestion(snapshot, puvodni)).toBe(false)
    expect(snapshotDiffersFromQuestion(snapshot, upravena)).toBe(true)
  })

  it('vykreslení i klíč berou znění ze snímku, ne z upravené otázky', async () => {
    const text = await vykresli([polozka(serializeQuestionSnapshot(puvodni))])
    expect(text).toContain('Kterým orgánem vstupuje vzduch do těla?')
    expect(text).toContain('Dutinou nosní')
    expect(text).not.toContain('ÚPLNĚ JINÉ ZADÁNÍ')
    expect(text).not.toContain('JINÁ ODPOVĚĎ')
  })

  it('úprava otázky v bance nezmění už vytištěné PDF', async () => {
    const snapshot = serializeQuestionSnapshot(puvodni)
    const pred = await vykresli([polozka(snapshot, puvodni)])
    const po = await vykresli([polozka(snapshot, upravena)])
    expect(po).toBe(pred)
  })

  it('poškozený snímek spadne zpět na živou otázku', async () => {
    const item = polozka('{"type":"short_answer","payload":')
    expect(item.question?.id).toBe(upravena.id)
    expect(item.questionEdited).toBe(false)
    expect(item.questionMissing).toBe(false)
    const text = await vykresli([item])
    expect(text).toContain('ÚPLNĚ JINÉ ZADÁNÍ')
  })

  it('chybějící snímek (starší data) znamená živou otázku', () => {
    const item = polozka(null)
    expect(item.question?.payload).toEqual(upravena.payload)
  })

  it('smazaná otázka test nerozsype — vykreslí se ze snímku', async () => {
    const item = polozka(serializeQuestionSnapshot(puvodni), null)
    expect(item.questionMissing).toBe(true)
    expect(item.questionEdited).toBe(false)
    const text = await vykresli([item])
    expect(text).toContain('Kterým orgánem vstupuje vzduch do těla?')
  })

  it('upravená otázka se označí, ale vykreslí se snímek', () => {
    const item = polozka(serializeQuestionSnapshot(puvodni))
    expect(item.questionEdited).toBe(true)
    expect(item.questionMissing).toBe(false)
  })
})
