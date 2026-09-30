import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { auditLog, db, schools, templates, users } from '@/db'
import { nasaditSablony } from '@/db/sablony'
import { newId } from '@/lib/ids'
import { normalizovatDomenu, slugZNazvu } from '@/lib/skoly'
import { zapsatAudit } from '@/lib/uzivatel'
import { PATCH as upravitVlastni } from '@/app/api/sprava/skola/route'
import {
  GET as seznamSkol,
  PATCH as upravitSkolu,
  POST as zalozitSkolu,
} from '@/app/api/administrace/skoly/route'
import { POST as prepnout } from '@/app/api/administrace/skola/route'
import { jsonReq, seedUcet } from './helpers'
import { TEST_SKOLA_ID } from './setup'

/**
 * Školy: úprava vlastní školy správcem, zakládání a přepínání
 * administrátorem. Přihlašování je v testech vypnuté; za administrátora se
 * vydáváme přes `E2E_UZIVATEL`.
 */

let adminId: string

beforeEach(async () => {
  await db.update(schools).set({ googleDomain: null, googleAutoJoin: false })
  adminId = (await seedUcet({ role: 'administrator' })).userId
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function jakoAdmin() {
  vi.stubEnv('E2E_UZIVATEL', adminId)
}

async function jinaSkola(nazev = 'Jiná škola', googleDomain: string | null = null): Promise<string> {
  const id = newId()
  await db.insert(schools).values({ id, name: nazev, slug: id, googleDomain })
  return id
}

async function chyba(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

describe('normalizace', () => {
  it('doména se uloží malými písmeny, bez zavináče a mezer; prázdná jako null', () => {
    expect(normalizovatDomenu('  @Skola.CZ ')).toBe('skola.cz')
    expect(normalizovatDomenu('')).toBeNull()
    expect(normalizovatDomenu('   ')).toBeNull()
    expect(normalizovatDomenu(null)).toBeNull()
  })

  it('slug vznikne z názvu bez diakritiky', () => {
    expect(slugZNazvu('ZŠ Nádražní, Brno')).toBe('zs-nadrazni-brno')
    expect(slugZNazvu('!!!')).toBe('skola')
  })
})

describe('správce upraví svou školu', () => {
  it('název, doménu i automatické přiřazení', async () => {
    const response = await upravitVlastni(
      jsonReq('/api/sprava/skola', 'PATCH', {
        name: 'ZŠ Testovací',
        googleDomain: '@Test.CZ',
        googleAutoJoin: true,
      }),
    )
    expect(response.status).toBe(200)
    const [skola] = await db.select().from(schools).where(eq(schools.id, TEST_SKOLA_ID))
    expect(skola).toMatchObject({ name: 'ZŠ Testovací', googleDomain: 'test.cz', googleAutoJoin: true })

    const [udalost] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'skola-upravena'), eq(auditLog.schoolId, TEST_SKOLA_ID)))
    expect(udalost).toBeTruthy()
  })

  it('adresu a kontakty: web dostane https, prázdné pole se vymaže, neposlané zůstane', async () => {
    const prvni = await upravitVlastni(
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
    expect(prvni.status).toBe(200)
    let [skola] = await db.select().from(schools).where(eq(schools.id, TEST_SKOLA_ID))
    expect(skola).toMatchObject({
      street: 'Školní 12',
      city: 'Brno',
      website: 'https://www.zs-test.cz',
      principal: 'Mgr. Jana Nováková',
    })

    await upravitVlastni(jsonReq('/api/sprava/skola', 'PATCH', { phone: '', website: 'http://zs-test.cz' }))
    ;[skola] = await db.select().from(schools).where(eq(schools.id, TEST_SKOLA_ID))
    expect(skola).toMatchObject({ phone: null, website: 'http://zs-test.cz', city: 'Brno' })
  })

  it('prázdný název se odmítne', async () => {
    const response = await upravitVlastni(jsonReq('/api/sprava/skola', 'PATCH', { name: '  ' }))
    expect(response.status).toBe(400)
    expect(await chyba(response)).toBe('Škola musí mít název.')
  })

  it('doménu jiné školy si nevezme', async () => {
    await jinaSkola('Sousední škola', 'soused.cz')
    const response = await upravitVlastni(
      jsonReq('/api/sprava/skola', 'PATCH', { googleDomain: 'Soused.cz' }),
    )
    expect(response.status).toBe(409)
    expect(await chyba(response)).toBe(
      'Doména soused.cz už patří škole Sousední škola. Nejdřív ji tam odeberte.',
    )
  })

  it('učitelka školu neupraví', async () => {
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'ucitelka' })).userId)
    const response = await upravitVlastni(jsonReq('/api/sprava/skola', 'PATCH', { name: 'Moje' }))
    expect(response.status).toBe(403)
  })
})

describe('administrace škol', () => {
  it('správce se do ní nedostane — tváří se jako neexistující', async () => {
    expect((await seznamSkol()).status).toBe(404)
    const zalozeni = await zalozitSkolu(jsonReq('/api/administrace/skoly', 'POST', { name: 'Nová' }))
    expect(zalozeni.status).toBe(404)
    const prepnuti = await prepnout(
      jsonReq('/api/administrace/skola', 'POST', { schoolId: TEST_SKOLA_ID }),
    )
    expect(prepnuti.status).toBe(404)
  })

  it('administrátor vidí všechny školy s počtem účtů', async () => {
    const jina = await jinaSkola()
    jakoAdmin()
    const response = await seznamSkol()
    expect(response.status).toBe(200)
    const { skoly } = (await response.json()) as { skoly: { id: string; pocetUctu: number }[] }
    expect(skoly.map((s) => s.id)).toEqual(expect.arrayContaining([TEST_SKOLA_ID, jina]))
    expect(skoly.find((s) => s.id === jina)?.pocetUctu).toBe(0)
  })

  it('nová škola dostane vestavěné šablony a slug bez kolize', async () => {
    jakoAdmin()
    const prvni = await zalozitSkolu(
      jsonReq('/api/administrace/skoly', 'POST', { name: 'ZŠ Kolize', googleDomain: 'kolize.cz' }),
    )
    const druha = await zalozitSkolu(
      jsonReq('/api/administrace/skoly', 'POST', { name: 'ZŠ Kolize', city: 'Olomouc' }),
    )
    expect(prvni.status).toBe(200)
    expect(druha.status).toBe(200)
    const { id: idPrvni } = (await prvni.json()) as { id: string }
    const { id: idDruhe } = (await druha.json()) as { id: string }

    const [a] = await db.select().from(schools).where(eq(schools.id, idPrvni))
    const [b] = await db.select().from(schools).where(eq(schools.id, idDruhe))
    expect(a?.slug).toBe('zs-kolize')
    expect(b?.slug).toBe('zs-kolize-2')
    expect(a?.googleDomain).toBe('kolize.cz')
    expect(b?.city).toBe('Olomouc')

    const sablony = await db.select().from(templates).where(eq(templates.schoolId, idPrvni))
    expect(sablony.map((t) => t.slug).sort()).toEqual(BUILT_IN_TEMPLATES.map((t) => t.slug).sort())
  })

  it('upraví cizí školu, ale obsazenou doménu odmítne', async () => {
    const jina = await jinaSkola()
    await jinaSkola('Třetí škola', 'treti.cz')
    jakoAdmin()
    const ok = await upravitSkolu(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: jina, name: 'Přejmenovaná' }),
    )
    expect(ok.status).toBe(200)
    const kolize = await upravitSkolu(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: jina, googleDomain: 'treti.cz' }),
    )
    expect(kolize.status).toBe(409)
    const neni = await upravitSkolu(
      jsonReq('/api/administrace/skoly', 'PATCH', { id: 'neexistuje', name: 'X' }),
    )
    expect(neni.status).toBe(404)
  })

  it('přepnutí zapíše vybranou školu a událost s příznakem administrátora', async () => {
    const jina = await jinaSkola()
    jakoAdmin()
    const response = await prepnout(jsonReq('/api/administrace/skola', 'POST', { schoolId: jina }))
    expect(response.status).toBe(200)

    const [ucet] = await db.select().from(users).where(eq(users.id, adminId))
    expect(ucet?.activeSchoolId).toBe(jina)
    const [udalost] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'administrator-prepnul-skolu'), eq(auditLog.schoolId, jina)))
    expect(udalost?.detail).toMatchObject({ administrator: true })
  })

  it('přepnutí do domovské školy výběr smaže', async () => {
    const jina = await jinaSkola()
    await db.update(users).set({ activeSchoolId: jina }).where(eq(users.id, adminId))
    jakoAdmin()
    const response = await prepnout(
      jsonReq('/api/administrace/skola', 'POST', { schoolId: TEST_SKOLA_ID }),
    )
    expect(response.status).toBe(200)
    const [ucet] = await db.select().from(users).where(eq(users.id, adminId))
    expect(ucet?.activeSchoolId).toBeNull()
  })

  it('přepnutí na neexistující školu vrátí 404 a nic nezmění', async () => {
    jakoAdmin()
    const response = await prepnout(jsonReq('/api/administrace/skola', 'POST', { schoolId: 'nic' }))
    expect(response.status).toBe(404)
    expect(await chyba(response)).toBe('Škola se nenašla.')
    const [ucet] = await db.select().from(users).where(eq(users.id, adminId))
    expect(ucet?.activeSchoolId).toBeNull()
  })
})

describe('záznam událostí pozná administrátora', () => {
  it('příznak jen mimo jeho domovskou školu', async () => {
    const jina = await jinaSkola()
    await zapsatAudit({ schoolId: jina, userId: adminId, action: 'zkouska-cizi' })
    await zapsatAudit({ schoolId: TEST_SKOLA_ID, userId: adminId, action: 'zkouska-doma' })

    const [cizi] = await db.select().from(auditLog).where(eq(auditLog.action, 'zkouska-cizi'))
    const [doma] = await db.select().from(auditLog).where(eq(auditLog.action, 'zkouska-doma'))
    expect(cizi?.detail).toMatchObject({ administrator: true })
    expect(doma?.detail).toBeNull()
  })
})

describe('šablony', () => {
  it('nasazení je opakovatelné a nepřepisuje šablony jiné školy', async () => {
    const jina = await jinaSkola()
    await nasaditSablony(db, TEST_SKOLA_ID)
    await nasaditSablony(db, jina)
    await nasaditSablony(db, jina)

    const vlastni = await db.select().from(templates).where(eq(templates.schoolId, TEST_SKOLA_ID))
    const cizi = await db.select().from(templates).where(eq(templates.schoolId, jina))
    expect(vlastni).toHaveLength(BUILT_IN_TEMPLATES.length)
    expect(cizi).toHaveLength(BUILT_IN_TEMPLATES.length)
  })
})
