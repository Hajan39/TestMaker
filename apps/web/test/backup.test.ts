import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  db,
  grades,
  materials,
  promptRules,
  questions,
  subjects,
  templates,
  testItems,
  tests,
  topics,
} from '@/db'
import { GET, POST } from '@/app/api/export/route'
import { TABLE_ORDER, countRows, backupText } from '@/lib/backup'
import { restoreFromBackup, countsInBackup, parseBackup } from '@/lib/backupClient'
import { createPromptRule } from '@/lib/promptRules'
import { jsonReq, seedMaterial, seedQuestion, seedTemplate, seedTopic, ACCOUNT } from './helpers'

/**
 * Backup and restore. The test goes there and back over a real (temporary)
 * database: the library is exported, deleted entirely and loaded back — and
 * the counts and the frozen question in the test must match, because that is
 * the only thing holding an already printed test's form after the question is
 * deleted from the bank.
 */

/** A small but complete library: a topic with materials (including a duplicate) and a test. */
async function seedLibrary() {
  const { topicId } = await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Dýchací soustava' })
  const originalId = await seedMaterial(topicId, { fileName: 'plice.txt', text: 'Plíce a průdušky. '.repeat(20) })
  const copyId = await seedMaterial(topicId, { fileName: 'plice.pdf', text: 'Plíce a průdušky. '.repeat(20) })
  // A material marked as the same content — a reference within the same table
  // is the only place where write order matters.
  await db
    .update(materials)
    .set({ duplicateOfId: originalId, duplicateScore: 0.97 })
    .where(eq(materials.id, copyId))

  const questionId = await seedQuestion(topicId, { prompt: 'Kde probíhá výměna plynů?' })
  const templateId = await seedTemplate()

  await db.insert(tests).values({
    id: 'test-zaloha',
    schoolId: ACCOUNT.schoolId,
    ownerId: ACCOUNT.userId,
    title: 'Opakování — dýchací soustava',
    templateId,
    header: { schoolName: '', teacher: '', dateLine: true } as never,
  })
  await db.insert(testItems).values({
    id: 'polozka-zaloha',
    schoolId: ACCOUNT.schoolId,
    testId: 'test-zaloha',
    position: 0,
    kind: 'question',
    questionId: questionId,
    questionSnapshot: JSON.stringify({
      type: 'single_choice',
      payload: { prompt: 'Zmrazené zadání', options: ['a', 'b'], correctIndex: 1 },
      points: 1,
    }),
  })

  return { topicId, questionId, originalId, copyId }
}

/** Deletes the whole library — as if restoring onto a clean deployment. */
async function wipe() {
  await db.delete(testItems)
  await db.delete(tests)
  await db.delete(templates)
  await db.delete(promptRules)
  await db.delete(questions)
  await db.delete(materials)
  await db.delete(topics)
  await db.delete(grades)
  await db.delete(subjects)
}

/**
 * Restore as the browser does it: `restoreFromBackup` slices the file into
 * batches and sends them to `/api/export`. Instead of the network the route
 * handler is called directly, so the test takes the same path as the app.
 */
async function restoreViaApi(text: string): Promise<Record<string, number>> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init: RequestInit) =>
    POST(jsonReq('/api/export', 'POST', JSON.parse(String(init.body))))) as typeof fetch
  try {
    return await restoreFromBackup(parseBackup(text))
  } finally {
    globalThis.fetch = originalFetch
  }
}

/** The whole backup from the downloaded file (`GET /api/export`). */
async function download(): Promise<string> {
  const response = await GET()
  expect(response.headers.get('content-disposition')).toContain('testmaker-zaloha-')
  return await response.text()
}

describe('backup and restore', () => {
  beforeEach(async () => {
    await wipe()
  })

  it('the downloaded backup has the file shape and contains all tables', async () => {
    await seedLibrary()
    const backup = parseBackup(await download())

    expect(backup.format).toBe('testmaker-zaloha')
    // The generation queue is not in the file and tables come in the order
    // they may be written.
    expect(Object.keys(backup.tabulky)).toEqual(TABLE_ORDER)
    expect(countsInBackup(backup)).toMatchObject({
      subjects: 1,
      grades: 1,
      topics: 1,
      materials: 2,
      questions: 1,
      tests: 1,
      test_items: 1,
    })
  })

  it('a round trip gives the same counts and an identical frozen question', async () => {
    const { questionId } = await seedLibrary()
    const before = await countRows(db, { schoolId: ACCOUNT.schoolId })
    const snapshotBefore = (await db.select().from(testItems))[0]!.questionSnapshot
    const text = await download()

    await wipe()
    expect((await countRows(db, { schoolId: ACCOUNT.schoolId })).questions).toBe(0)

    const restored = await restoreViaApi(text)

    expect(await countRows(db, { schoolId: ACCOUNT.schoolId })).toEqual(before)
    expect(restored.questions).toBe(before.questions)

    const [item] = await db.select().from(testItems)
    expect(item!.questionSnapshot).toBe(snapshotBefore)
    expect(item!.questionId).toBe(questionId)
  })

  it('a worksheet survives export and restore with its content and the verify flag', async () => {
    const { topicId } = await seedLibrary()
    await db.update(tests).set({ kind: 'pracovni_list', topicId, brief: '{"title":"Plíce"}', graded: false })
    const table = { header: ['A', 'B'], rows: [[{ value: 'x', blank: false }, { value: 'y', blank: true }]] }
    await db.insert(testItems).values({
      id: 'polozka-tabulka',
      schoolId: ACCOUNT.schoolId,
      testId: 'test-zaloha',
      position: 1,
      kind: 'table',
      content: table,
      needsCheck: true,
    })
    const text = await download()
    await wipe()
    await restoreViaApi(text)

    const [list] = await db.select().from(tests)
    expect(list).toMatchObject({ kind: 'pracovni_list', topicId, brief: '{"title":"Plíce"}', graded: false })
    const [tableItem] = await db.select().from(testItems).where(eq(testItems.id, 'polozka-tabulka'))
    expect(tableItem).toMatchObject({ kind: 'table', content: table, needsCheck: true })
  })

  it('an older backup without worksheet columns restores with defaults', async () => {
    await seedLibrary()
    const backup = JSON.parse(await download()) as { tabulky: Record<string, Record<string, unknown>[]> }
    for (const row of backup.tabulky.tests ?? []) {
      delete row.kind
      delete row.topicId
      delete row.brief
    }
    for (const row of backup.tabulky.test_items ?? []) {
      delete row.content
      delete row.needsCheck
    }
    await wipe()
    await restoreViaApi(JSON.stringify(backup))

    const [test] = await db.select().from(tests)
    expect(test).toMatchObject({ kind: 'pisemka', topicId: null, brief: null })
    const [item] = await db.select().from(testItems)
    expect(item).toMatchObject({ content: null, needsCheck: false })
  })

  it('a prompt rule survives export and restore (unlike regeneration feedback)', async () => {
    await seedLibrary()
    await createPromptRule(ACCOUNT, { text: 'Piš spisovnou a jednoduchou češtinou bez chyb.', reason: 'cestina' })
    const before = await countRows(db, { schoolId: ACCOUNT.schoolId })
    expect(before.prompt_rules).toBe(1)

    const text = await download()
    await wipe()
    expect((await countRows(db, { schoolId: ACCOUNT.schoolId })).prompt_rules).toBe(0)

    await restoreViaApi(text)
    expect(await countRows(db, { schoolId: ACCOUNT.schoolId })).toEqual(before)

    const [rule] = await db.select().from(promptRules)
    expect(rule!.text).toBe('Piš spisovnou a jednoduchou češtinou bez chyb.')
    expect(rule!.reason).toBe('cestina')
  })

  it('a material marked as a duplicate keeps its link to the original after restore', async () => {
    const { originalId, copyId } = await seedLibrary()
    const text = await download()
    await wipe()
    await restoreViaApi(text)

    const [copy] = await db.select().from(materials).where(eq(materials.id, copyId))
    expect(copy!.duplicateOfId).toBe(originalId)
    expect(copy!.duplicateScore).toBeCloseTo(0.97)
  })

  it('a question version in an earlier batch than its root restores with the link', async () => {
    const { topicId } = await seedLibrary()
    // Backup and restore go in batches ordered by `id`. The version id sorts
    // first and the root id last, with over two hundred other questions in
    // between — so the version arrives in the first batch, the root only in
    // the second, and without writing the link afterwards the insert would
    // fail on the foreign key.
    for (let i = 0; i < 210; i++) await seedQuestion(topicId, { prompt: `Výplň ${i}` })
    const rootId = await seedQuestion(topicId, { prompt: 'Kořen verzí' })
    const versionId = await seedQuestion(topicId, { prompt: 'Lehčí verze kořene' })
    await db.update(questions).set({ id: '~koren' }).where(eq(questions.id, rootId))
    await db.update(questions).set({ id: '!verze', variantOf: '~koren', difficulty: 1 }).where(eq(questions.id, versionId))

    const text = await download()
    const rows = parseBackup(text).tabulky.questions as { id: string }[]
    expect(rows[0]!.id).toBe('!verze')
    expect(rows.at(-1)!.id).toBe('~koren')
    expect(rows.length).toBeGreaterThan(200)

    await wipe()
    await restoreViaApi(text)

    const [version] = await db.select().from(questions).where(eq(questions.id, '!verze'))
    expect(version!.variantOf).toBe('~koren')
    expect(version!.difficulty).toBe(1)
  })

  it('a repeated restore duplicates nothing', async () => {
    await seedLibrary()
    const before = await countRows(db, { schoolId: ACCOUNT.schoolId })
    const text = await download()

    // First into a library that still has the data — a restore is a merge,
    // not a second import.
    await restoreViaApi(text)
    expect(await countRows(db, { schoolId: ACCOUNT.schoolId })).toEqual(before)

    await restoreViaApi(text)
    expect(await countRows(db, { schoolId: ACCOUNT.schoolId })).toEqual(before)
  })

  it('a restore into a non-empty library only adds and deletes nothing', async () => {
    await seedLibrary()
    const text = await download()
    await wipe()

    // Another topic not in the backup: the restore must leave it alone.
    const { topicId: foreignTopic } = await seedTopic({ subject: 'ZEMĚPIS', topic: 'Podnebné pásy' })
    await seedQuestion(foreignTopic, { prompt: 'Kolik je podnebných pásů?' })

    await restoreViaApi(text)

    const counts = await countRows(db, { schoolId: ACCOUNT.schoolId })
    expect(counts.topics).toBe(2)
    expect(counts.questions).toBe(2)
  })

  it('an edited question is aligned back to the backup by a restore', async () => {
    const { questionId } = await seedLibrary()
    const text = await download()

    await db
      .update(questions)
      .set({ payload: { prompt: 'Překlep', options: ['a'], correctIndex: 0 } as never })
      .where(eq(questions.id, questionId))

    await restoreViaApi(text)

    const [question] = await db.select().from(questions).where(eq(questions.id, questionId))
    expect((question!.payload as { prompt: string }).prompt).toBe('Kde probíhá výměna plynů?')
  })

  it('a large backup streams in chunks, not as one string at once', async () => {
    const { topicId } = await seedLibrary()
    for (let i = 0; i < 250; i++) await seedQuestion(topicId, { prompt: `Otázka ${i}` })

    // Chunks arrive continuously — if the backup were assembled in memory,
    // one big chunk would arrive only at the end.
    const stream = (await GET()).body!
    const reader = stream.getReader()
    let chunks = 0
    for (;;) {
      const { done } = await reader.read()
      if (done) break
      chunks += 1
    }
    expect(chunks).toBeGreaterThan(1)

    const backup = parseBackup(await backupText(db, { schoolId: ACCOUNT.schoolId }))
    expect(backup.tabulky.questions).toHaveLength(251)
  })

  it('a foreign file is rejected with a message and nothing is written', async () => {
    expect(() => parseBackup('{"neco":1}')).toThrow(/není záloha TestMakeru/i)
    expect(() => parseBackup('nic')).toThrow(/platný JSON/i)

    const response = await POST(jsonReq('/api/export', 'POST', { table: 'faktury', rows: [] }))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/Neznámá část zálohy/)
  })

  it('an item with the same name but another id is explained, not with an SQLite message', async () => {
    await seedLibrary()
    const text = await download()
    await wipe()

    // Someone meanwhile created a subject of the same name on the other side —
    // they cannot be merged by name, so the restore must say what to do.
    await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Něco jiného' })

    await expect(restoreViaApi(text)).rejects.toThrow(/stejným názvem|Přejmenuj/i)
  })

  it('a row without id is rejected instead of silently dropped', async () => {
    const response = await POST(
      jsonReq('/api/export', 'POST', { table: 'subjects', rows: [{ name: 'Bez id' }] }),
    )
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toMatch(/nemá id/)
    expect((await countRows(db, { schoolId: ACCOUNT.schoolId })).subjects).toBe(0)
  })
})
