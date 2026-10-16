import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { DEFAULT_GRADE_SCALE, type GradeScale } from '@testmaker/core/schema'
import { auditLog, db, schools, users } from '@/db'
import { newId } from '@/lib/ids'
import { loadRenderableTest } from '@/lib/tests'
import { GET, PUT } from '@/app/api/sprava/hodnoceni/route'
import { POST as createTest } from '@/app/api/tests/route'
import { jsonReq, seedAccount, seedTemplate, ACCOUNT } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/** The school's grade scale in Správa: read, save, reset — manager only, own school only. */

/** The built-in scale with the 20-point row corrected by the school. */
const CUSTOM: GradeScale = {
  percents: [85, 70, 45, 25],
  rows: DEFAULT_GRADE_SCALE.rows.map((row) =>
    row.total === 20 ? { total: 20, ranges: [[20, 19], [18, 15], [14, 9], [8, 4], [3, 0]] } : row,
  ),
}

const put = (scale: unknown) => PUT(jsonReq('/api/sprava/hodnoceni', 'PUT', { scale }))
const read = async () => (await (await GET()).json()) as { scale: GradeScale; custom: boolean }

async function auditActions(): Promise<string[]> {
  const rows = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(and(eq(auditLog.schoolId, TEST_SCHOOL_ID), eq(auditLog.entity, 'school')))
  return rows.map((row) => row.action)
}

beforeEach(async () => {
  await db.update(schools).set({ gradeScale: null })
  await db.delete(auditLog)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('grade scale in Správa', () => {
  it('starts with the built-in table', async () => {
    expect(await read()).toEqual({ scale: DEFAULT_GRADE_SCALE, custom: false })
  })

  it('a manager saves the school’s own scale and resets it, each change audited', async () => {
    const saved = await put(CUSTOM)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ scale: CUSTOM, custom: true })
    expect(await read()).toEqual({ scale: CUSTOM, custom: true })
    expect(await auditActions()).toEqual(['hodnoceni-upraveno'])

    const reset = await put(null)
    expect(reset.status).toBe(200)
    expect(await read()).toEqual({ scale: DEFAULT_GRADE_SCALE, custom: false })
    const [school] = await db.select().from(schools).where(eq(schools.id, TEST_SCHOOL_ID))
    expect(school!.gradeScale).toBeNull()
    expect((await auditActions()).sort()).toEqual(['hodnoceni-upraveno', 'hodnoceni-vychozi'])
  })

  it('rejects a table with a gap with a Czech message and keeps the stored one', async () => {
    await put(CUSTOM)
    const broken = {
      ...CUSTOM,
      rows: [{ total: 20, ranges: [[20, 18], [16, 14], [13, 8], [7, 4], [3, 0]] }],
    }
    const response = await put(broken)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Mezi známkou 1 a 2 chybí body – známka 2 má začínat na 17.',
    })
    expect((await read()).scale).toEqual(CUSTOM)
  })

  it('a teacher can neither read nor save the scale', async () => {
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'ucitelka' })).userId)
    expect((await GET()).status).toBe(403)
    expect((await put(CUSTOM)).status).toBe(403)
    vi.unstubAllEnvs()
    expect((await read()).custom).toBe(false)
  })

  it('a manager of another school changes only their own school', async () => {
    const otherSchool = newId()
    await db.insert(schools).values({ id: otherSchool, name: 'Jiná škola', slug: otherSchool })
    const otherManager = newId()
    await db.insert(users).values({
      id: otherManager,
      schoolId: otherSchool,
      email: `${otherManager}@localhost`,
      name: 'Správce jinde',
      role: 'spravce',
    })
    await put(CUSTOM)

    vi.stubEnv('E2E_UZIVATEL', otherManager)
    // The other school still sees the built-in table, not ours …
    expect(await read()).toEqual({ scale: DEFAULT_GRADE_SCALE, custom: false })
    // … and its reset leaves ours alone.
    expect((await put(null)).status).toBe(200)
    vi.unstubAllEnvs()
    expect(await read()).toEqual({ scale: CUSTOM, custom: true })
  })

  it('the printed test gets the school’s scale', async () => {
    await put(CUSTOM)
    const templateId = await seedTemplate()
    const created = await createTest(
      jsonReq('/api/tests', 'POST', { title: 'Hodnocená písemka', templateId, header: {}, items: [] }),
    )
    const { id } = (await created.json()) as { id: string }
    const renderable = await loadRenderableTest(ACCOUNT, id, { variant: 'A', withKey: true })
    expect(renderable?.gradeScale).toEqual(CUSTOM)
  })
})
