import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { auditLog, db, schools, templates, users } from '@/db'
import { seedTemplates } from '@/db/templates'
import { newId } from '@/lib/ids'
import { normalizeDomain, slugFromName } from '@/lib/schools'
import { writeAudit } from '@/lib/user'
import { PATCH as editOwn } from '@/app/api/sprava/skola/route'
import {
  GET as listSchools,
  PATCH as updateSchool,
  POST as createSchool,
} from '@/app/api/administrace/skoly/route'
import { POST as switchTo } from '@/app/api/administrace/skola/route'
import { jsonReq, seedAccount } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

/**
 * Schools: a manager edits their own school, an administrator creates and
 * switches. Sign-in is disabled in tests; we impersonate the administrator
 * via `E2E_UZIVATEL`.
 */

let adminId: string

beforeEach(async () => {
  await db.update(schools).set({ googleDomain: null, googleAutoJoin: false })
  adminId = (await seedAccount({ role: 'administrator' })).userId
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function asAdmin() {
  vi.stubEnv('E2E_UZIVATEL', adminId)
}

async function otherSchool(name = 'Jiná škola', googleDomain: string | null = null): Promise<string> {
  const id = newId()
  await db.insert(schools).values({ id, name: name, slug: id, googleDomain })
  return id
}

async function error(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

describe('normalizace', () => {
  it('stores the domain lowercase, without at sign and spaces; empty as null', () => {
    expect(normalizeDomain('  @Skola.CZ ')).toBe('skola.cz')
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
  })

  it('derives the slug from the name without diacritics', () => {
    expect(slugFromName('ZŠ Nádražní, Brno')).toBe('zs-nadrazni-brno')
    expect(slugFromName('!!!')).toBe('skola')
  })
})

describe('a manager edits their school', () => {
  it('name, domain and automatic joining', async () => {
    const response = await editOwn(
      jsonReq('/api/sprava/skola', 'PATCH', {
        name: 'ZŠ Testovací',
        googleDomain: '@Test.CZ',
        googleAutoJoin: true,
      }),
    )
    expect(response.status).toBe(200)
    const [school] = await db.select().from(schools).where(eq(schools.id, TEST_SCHOOL_ID))
    expect(school).toMatchObject({ name: 'ZŠ Testovací', googleDomain: 'test.cz', googleAutoJoin: true })

    const [event] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'skola-upravena'), eq(auditLog.schoolId, TEST_SCHOOL_ID)))
    expect(event).toBeTruthy()
  })

  it('address and contacts: the website gets https, an empty field is cleared, an unsent one stays', async () => {
    const first = await editOwn(
      jsonReq('/api/sprava/skola', 'PATCH', {
        street: ' Školní 12 ',
        city: 'Brno',
        postalCode: '602 00',
        website: 'www.zs-test.cz',
        email: 'info@zs-test.cz',
        phone: '+420 541 000 000',
        ico: '12345678',
        principal: 'Mgr. Jana Nováková',
      }),
    )
    expect(first.status).toBe(200)
    let [school] = await db.select().from(schools).where(eq(schools.id, TEST_SCHOOL_ID))
    expect(school).toMatchObject({
      street: 'Školní 12',
      city: 'Brno',
      website: 'https://www.zs-test.cz',
      principal: 'Mgr. Jana Nováková',
    })

    await editOwn(jsonReq('/api/sprava/skola', 'PATCH', { phone: '', website: 'http://zs-test.cz' }))
    ;[school] = await db.select().from(schools).where(eq(schools.id, TEST_SCHOOL_ID))
    expect(school).toMatchObject({ phone: null, website: 'http://zs-test.cz', city: 'Brno' })
  })

  it('rejects an empty name', async () => {
    const response = await editOwn(jsonReq('/api/sprava/skola', 'PATCH', { name: '  ' }))
    expect(response.status).toBe(400)
    expect(await error(response)).toBe('Škola musí mít název.')
  })

  it('cannot take the domain of another school', async () => {
    await otherSchool('Sousední škola', 'soused.cz')
    const response = await editOwn(
      jsonReq('/api/sprava/skola', 'PATCH', { googleDomain: 'Soused.cz' }),
    )
    expect(response.status).toBe(409)
    expect(await error(response)).toBe(
      'Doména soused.cz už patří škole Sousední škola. Nejdřív ji tam odeberte.',
    )
  })

  it('a teacher cannot edit the school', async () => {
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'ucitelka' })).userId)
    const response = await editOwn(jsonReq('/api/sprava/skola', 'PATCH', { name: 'Moje' }))
    expect(response.status).toBe(403)
  })
})

describe('school administration', () => {
  it('a manager cannot get in — it pretends not to exist', async () => {
    expect((await listSchools()).status).toBe(404)
    const creation = await createSchool(jsonReq('/api/administrace/skoly', 'POST', { name: 'Nová' }))
    expect(creation.status).toBe(404)
    const switchEvent = await switchTo(
      jsonReq('/api/administrace/skola', 'POST', { schoolId: TEST_SCHOOL_ID }),
    )
    expect(switchEvent.status).toBe(404)
  })

  it('the administrator sees all schools with account counts', async () => {
    const other = await otherSchool()
    asAdmin()
    const response = await listSchools()
    expect(response.status).toBe(200)
    const { schools: schoolList } = (await response.json()) as { schools: { id: string; accountCount: number }[] }
    expect(schoolList.map((s) => s.id)).toEqual(expect.arrayContaining([TEST_SCHOOL_ID, other]))
    expect(schoolList.find((s) => s.id === other)?.accountCount).toBe(0)
  })

  it('a new school gets built-in templates and a collision-free slug', async () => {
    asAdmin()
    const first = await createSchool(
      jsonReq('/api/administrace/skoly', 'POST', { name: 'ZŠ Kolize', googleDomain: 'kolize.cz' }),
    )
    const second = await createSchool(
      jsonReq('/api/administrace/skoly', 'POST', { name: 'ZŠ Kolize', city: 'Olomouc' }),
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const { id: firstId } = (await first.json()) as { id: string }
    const { id: secondId } = (await second.json()) as { id: string }

    const [a] = await db.select().from(schools).where(eq(schools.id, firstId))
    const [b] = await db.select().from(schools).where(eq(schools.id, secondId))
    expect(a?.slug).toBe('zs-kolize')
    expect(b?.slug).toBe('zs-kolize-2')
    expect(a?.googleDomain).toBe('kolize.cz')
    expect(b?.city).toBe('Olomouc')

    const templateRows = await db.select().from(templates).where(eq(templates.schoolId, firstId))
    expect(templateRows.map((t) => t.slug).sort()).toEqual(BUILT_IN_TEMPLATES.map((t) => t.slug).sort())
  })

  it('edits a foreign school but rejects a taken domain', async () => {
    const other = await otherSchool()
    await otherSchool('Třetí škola', 'treti.cz')
    asAdmin()
    const ok = await updateSchool(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: other, name: 'Přejmenovaná' }),
    )
    expect(ok.status).toBe(200)
    const collision = await updateSchool(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: other, googleDomain: 'treti.cz' }),
    )
    expect(collision.status).toBe(409)
    const missing = await updateSchool(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: 'neexistuje', name: 'X' }),
    )
    expect(missing.status).toBe(404)
  })

  it('switching stores the chosen school and an event with the administrator flag', async () => {
    const other = await otherSchool()
    asAdmin()
    const response = await switchTo(jsonReq('/api/administrace/skola', 'POST', { schoolId: other }))
    expect(response.status).toBe(200)

    const [account] = await db.select().from(users).where(eq(users.id, adminId))
    expect(account?.activeSchoolId).toBe(other)
    const [event] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'administrator-prepnul-skolu'), eq(auditLog.schoolId, other)))
    expect(event?.detail).toMatchObject({ administrator: true })
  })

  it('switching to the home school clears the choice', async () => {
    const other = await otherSchool()
    await db.update(users).set({ activeSchoolId: other }).where(eq(users.id, adminId))
    asAdmin()
    const response = await switchTo(
      jsonReq('/api/administrace/skola', 'POST', { schoolId: TEST_SCHOOL_ID }),
    )
    expect(response.status).toBe(200)
    const [account] = await db.select().from(users).where(eq(users.id, adminId))
    expect(account?.activeSchoolId).toBeNull()
  })

  it('switching to a nonexistent school returns 404 and changes nothing', async () => {
    asAdmin()
    const response = await switchTo(jsonReq('/api/administrace/skola', 'POST', { schoolId: 'nic' }))
    expect(response.status).toBe(404)
    expect(await error(response)).toBe('Škola se nenašla.')
    const [account] = await db.select().from(users).where(eq(users.id, adminId))
    expect(account?.activeSchoolId).toBeNull()
  })
})

describe('the event log recognises the administrator', () => {
  it('flags only outside their home school', async () => {
    const other = await otherSchool()
    await writeAudit({ schoolId: other, userId: adminId, action: 'zkouska-cizi' })
    await writeAudit({ schoolId: TEST_SCHOOL_ID, userId: adminId, action: 'zkouska-doma' })

    const [foreign] = await db.select().from(auditLog).where(eq(auditLog.action, 'zkouska-cizi'))
    const [home] = await db.select().from(auditLog).where(eq(auditLog.action, 'zkouska-doma'))
    expect(foreign?.detail).toMatchObject({ administrator: true })
    expect(home?.detail).toBeNull()
  })
})

describe('templates', () => {
  it('seeding is repeatable and does not overwrite templates of another school', async () => {
    const other = await otherSchool()
    await seedTemplates(db, TEST_SCHOOL_ID)
    await seedTemplates(db, other)
    await seedTemplates(db, other)

    const ownTemplates = await db.select().from(templates).where(eq(templates.schoolId, TEST_SCHOOL_ID))
    const foreign = await db.select().from(templates).where(eq(templates.schoolId, other))
    expect(ownTemplates).toHaveLength(BUILT_IN_TEMPLATES.length)
    expect(foreign).toHaveLength(BUILT_IN_TEMPLATES.length)
  })
})
