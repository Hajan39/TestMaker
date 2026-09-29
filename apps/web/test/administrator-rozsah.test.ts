import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, puzzleWordDrafts, schools, testItems, tests, users } from '@/db'
import { newId } from '@/lib/ids'
import { copyTest, loadTest } from '@/lib/tests'
import { loadPuzzleWordDraft, savePuzzleWordDraft } from '@/lib/puzzles'
import { aktualniUzivatel, type Prihlaseny } from '@/lib/uzivatel'
import { seedTemplate, seedTopic } from './helpers'
import { TEST_SKOLA_ID } from './setup'

/**
 * Administrátor pracuje vždycky v jedné vybrané škole — v té má plná práva
 * včetně soukromých písemek, do ostatních nevidí, dokud se nepřepne.
 * `aktualniUzivatel` se tu volá bez přihlašování přes `E2E_UZIVATEL`, stejně
 * jako v ostatních testech rozsahu.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

async function skola(nazev: string): Promise<string> {
  const id = newId()
  await db.insert(schools).values({ id, name: nazev, slug: id })
  return id
}

async function ucet(schoolId: string, role: 'ucitelka' | 'administrator', activeSchoolId?: string) {
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId,
    email: `${id}@localhost`,
    name: `Účet ${id}`,
    role,
    activeSchoolId: activeSchoolId ?? null,
  })
  return id
}

async function soukromaPisemka(schoolId: string, ownerId: string): Promise<string> {
  const templateId = await seedTemplate()
  const id = newId()
  await db.insert(tests).values({
    id,
    schoolId,
    ownerId,
    visibility: 'soukrome',
    title: `Soukromá ${id}`,
    templateId,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' } as never,
  })
  await db.insert(testItems).values({ id: newId(), schoolId, testId: id, position: 0, kind: 'question' })
  return id
}

async function jako(userId: string): Promise<Prihlaseny> {
  vi.stubEnv('E2E_UZIVATEL', userId)
  const prihlaseny = await aktualniUzivatel()
  if (!prihlaseny) throw new Error('Účet se nenačetl')
  return prihlaseny
}

describe('vybraná škola administrátora', () => {
  it('rozsah nese vybranou školu, domovská zůstává vedle', async () => {
    const druha = await skola('Druhá škola')
    const admin = await ucet(TEST_SKOLA_ID, 'administrator', druha)

    const prihlaseny = await jako(admin)
    expect(prihlaseny.schoolId).toBe(druha)
    expect(prihlaseny.skola).toBe('Druhá škola')
    expect(prihlaseny.domovskaSkolaId).toBe(TEST_SKOLA_ID)
  })

  it('bez výběru pracuje v domovské škole', async () => {
    const admin = await ucet(TEST_SKOLA_ID, 'administrator')
    const prihlaseny = await jako(admin)
    expect(prihlaseny.schoolId).toBe(TEST_SKOLA_ID)
    expect(prihlaseny.domovskaSkolaId).toBe(TEST_SKOLA_ID)
  })

  it('zmizelá vybraná škola vrátí administrátora domů', async () => {
    const druha = await skola('Zmizí')
    const admin = await ucet(TEST_SKOLA_ID, 'administrator', druha)
    await db.delete(schools).where(eq(schools.id, druha))

    const prihlaseny = await jako(admin)
    expect(prihlaseny.schoolId).toBe(TEST_SKOLA_ID)
  })

  it('jiná role vybranou školu ignoruje, i kdyby ji v řádku měla', async () => {
    const druha = await skola('Nepatří jí')
    const ucitelka = await ucet(TEST_SKOLA_ID, 'ucitelka', druha)
    const prihlaseny = await jako(ucitelka)
    expect(prihlaseny.schoolId).toBe(TEST_SKOLA_ID)
  })
})

describe('plná práva ve vybrané škole', () => {
  it('vidí soukromou písemku tamní učitelky, ale ne písemku jiné školy', async () => {
    const druha = await skola('Druhá')
    const treti = await skola('Třetí')
    const pisemkaDruhe = await soukromaPisemka(druha, await ucet(druha, 'ucitelka'))
    const pisemkaTreti = await soukromaPisemka(treti, await ucet(treti, 'ucitelka'))
    const admin = await jako(await ucet(TEST_SKOLA_ID, 'administrator', druha))

    expect(await loadTest(admin, pisemkaDruhe)).not.toBeNull()
    expect(await loadTest(admin, pisemkaTreti)).toBeNull()
  })

  it('co vytvoří, patří vybrané škole', async () => {
    const druha = await skola('Druhá')
    const pisemka = await soukromaPisemka(druha, await ucet(druha, 'ucitelka'))
    const admin = await jako(await ucet(TEST_SKOLA_ID, 'administrator', druha))

    const kopie = await copyTest(admin, pisemka)
    expect(kopie).not.toBeNull()
    const [radek] = await db.select().from(tests).where(eq(tests.id, kopie!.id))
    expect(radek?.schoolId).toBe(druha)
    expect(radek?.ownerId).toBe(admin.userId)
  })

  it('rozpracovaná slova hlavolamu zůstávají osobní', async () => {
    const { topicId } = await seedTopic()
    const ucitelka = await jako(await ucet(TEST_SKOLA_ID, 'ucitelka'))
    await savePuzzleWordDraft(ucitelka, topicId, 'wordsearch', [{ word: 'ulita', clue: 'Schránka' }])

    const admin = await jako(await ucet(TEST_SKOLA_ID, 'administrator'))
    expect(await loadPuzzleWordDraft(admin, topicId, 'wordsearch')).toEqual([])

    await db.delete(puzzleWordDrafts)
  })
})
