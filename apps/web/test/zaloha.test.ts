import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  db,
  grades,
  materials,
  questions,
  subjects,
  templates,
  testItems,
  tests,
  topics,
} from '@/db'
import { GET, POST } from '@/app/api/export/route'
import { PORADI, spocitej, zalohaText } from '@/lib/backup'
import { obnovZeZalohy, poctyVZaloze, prectiZalohu } from '@/lib/backupClient'
import { jsonReq, seedMaterial, seedQuestion, seedTemplate, seedTopic } from './helpers'

/**
 * Záloha a obnova. Test jde tam i zpět nad skutečnou (dočasnou) databází:
 * knihovna se vyveze, celá se smaže a naveze se zpátky — a musí sedět počty
 * i zmrazená otázka v testu, protože právě ta je to jediné, co po smazání
 * otázky z banky drží podobu už vytištěné písemky.
 */

/** Malá, ale úplná knihovna: téma s materiály (včetně duplicity) i test. */
async function nasypKnihovnu() {
  const { topicId } = await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Dýchací soustava' })
  const originalId = await seedMaterial(topicId, { fileName: 'plice.txt', text: 'Plíce a průdušky. '.repeat(20) })
  const kopieId = await seedMaterial(topicId, { fileName: 'plice.pdf', text: 'Plíce a průdušky. '.repeat(20) })
  // Materiál označený jako tentýž obsah — odkaz uvnitř téže tabulky je
  // jediné místo, kde na pořadí zápisu záleží.
  await db
    .update(materials)
    .set({ duplicateOfId: originalId, duplicateScore: 0.97 })
    .where(eq(materials.id, kopieId))

  const otazkaId = await seedQuestion(topicId, { prompt: 'Kde probíhá výměna plynů?' })
  const templateId = await seedTemplate()

  await db.insert(tests).values({
    id: 'test-zaloha',
    title: 'Opakování — dýchací soustava',
    templateId,
    header: { schoolName: '', teacher: '', dateLine: true } as never,
  })
  await db.insert(testItems).values({
    id: 'polozka-zaloha',
    testId: 'test-zaloha',
    position: 0,
    kind: 'question',
    questionId: otazkaId,
    questionSnapshot: JSON.stringify({
      type: 'single_choice',
      payload: { prompt: 'Zmrazené zadání', options: ['a', 'b'], correctIndex: 1 },
      points: 1,
    }),
  })

  return { topicId, otazkaId, originalId, kopieId }
}

/** Smaže celou knihovnu — jako by se obnovovalo na čistém nasazení. */
async function vyprazdni() {
  await db.delete(testItems)
  await db.delete(tests)
  await db.delete(templates)
  await db.delete(questions)
  await db.delete(materials)
  await db.delete(topics)
  await db.delete(grades)
  await db.delete(subjects)
}

/**
 * Obnova tak, jak ji dělá prohlížeč: `obnovZeZalohy` krájí soubor na dávky
 * a posílá je na `/api/export`. Místo sítě se volá přímo route handler,
 * takže test prochází stejnou cestou jako aplikace.
 */
async function obnovPresApi(text: string): Promise<Record<string, number>> {
  const puvodniFetch = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init: RequestInit) =>
    POST(jsonReq('/api/export', 'POST', JSON.parse(String(init.body))))) as typeof fetch
  try {
    return await obnovZeZalohy(prectiZalohu(text))
  } finally {
    globalThis.fetch = puvodniFetch
  }
}

/** Celá záloha ze staženého souboru (`GET /api/export`). */
async function stahni(): Promise<string> {
  const odpoved = GET()
  expect(odpoved.headers.get('content-disposition')).toContain('testmaker-zaloha-')
  return await odpoved.text()
}

describe('záloha a obnova', () => {
  beforeEach(async () => {
    await vyprazdni()
  })

  it('stažená záloha má tvar souboru a obsahuje všechny tabulky', async () => {
    await nasypKnihovnu()
    const zaloha = prectiZalohu(await stahni())

    expect(zaloha.format).toBe('testmaker-zaloha')
    // Fronta generování v souboru není a tabulky jdou v pořadí, ve kterém se
    // smějí zapisovat.
    expect(Object.keys(zaloha.tabulky)).toEqual(PORADI)
    expect(poctyVZaloze(zaloha)).toMatchObject({
      subjects: 1,
      grades: 1,
      topics: 1,
      materials: 2,
      questions: 1,
      tests: 1,
      test_items: 1,
    })
  })

  it('tam a zpět dá tytéž počty i shodnou zmrazenou otázku', async () => {
    const { otazkaId } = await nasypKnihovnu()
    const pred = await spocitej(db)
    const snapshotPred = (await db.select().from(testItems))[0]!.questionSnapshot
    const text = await stahni()

    await vyprazdni()
    expect((await spocitej(db)).questions).toBe(0)

    const navezeno = await obnovPresApi(text)

    expect(await spocitej(db)).toEqual(pred)
    expect(navezeno.questions).toBe(pred.questions)

    const [polozka] = await db.select().from(testItems)
    expect(polozka!.questionSnapshot).toBe(snapshotPred)
    expect(polozka!.questionId).toBe(otazkaId)
  })

  it('materiál označený jako duplicita si po obnově drží odkaz na originál', async () => {
    const { originalId, kopieId } = await nasypKnihovnu()
    const text = await stahni()
    await vyprazdni()
    await obnovPresApi(text)

    const [kopie] = await db.select().from(materials).where(eq(materials.id, kopieId))
    expect(kopie!.duplicateOfId).toBe(originalId)
    expect(kopie!.duplicateScore).toBeCloseTo(0.97)
  })

  it('opakovaná obnova nic nezdvojí', async () => {
    await nasypKnihovnu()
    const pred = await spocitej(db)
    const text = await stahni()

    // Poprvé do knihovny, ve které data pořád jsou — obnova je sloučení, ne
    // druhý import.
    await obnovPresApi(text)
    expect(await spocitej(db)).toEqual(pred)

    await obnovPresApi(text)
    expect(await spocitej(db)).toEqual(pred)
  })

  it('obnova do knihovny, kde už něco je, jen doplní a nic nesmaže', async () => {
    await nasypKnihovnu()
    const text = await stahni()
    await vyprazdni()

    // Jiné téma, které v záloze není: obnova ho musí nechat být.
    const { topicId: ciziTopic } = await seedTopic({ subject: 'ZEMĚPIS', topic: 'Podnebné pásy' })
    await seedQuestion(ciziTopic, { prompt: 'Kolik je podnebných pásů?' })

    await obnovPresApi(text)

    const pocty = await spocitej(db)
    expect(pocty.topics).toBe(2)
    expect(pocty.questions).toBe(2)
  })

  it('upravená otázka se obnovou srovná zpátky podle zálohy', async () => {
    const { otazkaId } = await nasypKnihovnu()
    const text = await stahni()

    await db
      .update(questions)
      .set({ payload: { prompt: 'Překlep', options: ['a'], correctIndex: 0 } as never })
      .where(eq(questions.id, otazkaId))

    await obnovPresApi(text)

    const [otazka] = await db.select().from(questions).where(eq(questions.id, otazkaId))
    expect((otazka!.payload as { prompt: string }).prompt).toBe('Kde probíhá výměna plynů?')
  })

  it('velká záloha odtéká po kouscích, ne jako jeden řetězec naráz', async () => {
    const { topicId } = await nasypKnihovnu()
    for (let i = 0; i < 250; i++) await seedQuestion(topicId, { prompt: `Otázka ${i}` })

    // Kousky chodí průběžně — kdyby se záloha skládala v paměti, přišel by
    // jeden velký kus až na konci.
    const stream = GET().body!
    const reader = stream.getReader()
    let kousku = 0
    for (;;) {
      const { done } = await reader.read()
      if (done) break
      kousku += 1
    }
    expect(kousku).toBeGreaterThan(1)

    const zaloha = prectiZalohu(await zalohaText(db))
    expect(zaloha.tabulky.questions).toHaveLength(251)
  })

  it('cizí soubor se odmítne českou hláškou a nic nezapíše', async () => {
    expect(() => prectiZalohu('{"neco":1}')).toThrow(/není záloha TestMakeru/i)
    expect(() => prectiZalohu('nic')).toThrow(/platný JSON/i)

    const odpoved = await POST(jsonReq('/api/export', 'POST', { tabulka: 'faktury', radky: [] }))
    expect(odpoved.status).toBe(400)
    expect(((await odpoved.json()) as { error: string }).error).toMatch(/Neznámá část zálohy/)
  })

  it('položka téhož jména s jiným id se vysvětlí česky, ne hláškou ze SQLite', async () => {
    await nasypKnihovnu()
    const text = await stahni()
    await vyprazdni()

    // Někdo mezitím založil předmět téhož jména na druhé straně — sloučit je
    // podle jména nejde, takže obnova musí říct, co s tím.
    await seedTopic({ subject: 'PŘÍRODOPIS', topic: 'Něco jiného' })

    await expect(obnovPresApi(text)).rejects.toThrow(/stejným názvem|Přejmenuj/i)
  })

  it('řádek bez id se odmítne, místo aby se tiše zahodil', async () => {
    const odpoved = await POST(
      jsonReq('/api/export', 'POST', { tabulka: 'subjects', radky: [{ name: 'Bez id' }] }),
    )
    expect(odpoved.status).toBe(400)
    expect(((await odpoved.json()) as { error: string }).error).toMatch(/nemá id/)
    expect((await spocitej(db)).subjects).toBe(0)
  })
})
