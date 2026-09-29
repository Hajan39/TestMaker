import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  DELETE as zablokovat,
  GET as seznam,
  PATCH as upravit,
  POST as zalozit,
} from '@/app/api/sprava/uzivatele/route'
import { db, sessions, users } from '@/db'
import { overitHeslo } from '@/lib/heslo'
import { jsonReq, req, seedUcet, UCET } from './helpers'

/**
 * Správa účtů. Testuje se přímým voláním obsluhy tras; přihlašování je
 * v testech vypnuté, takže se pracuje pod výchozím správcem (`UCET`).
 */

beforeEach(async () => {
  await db.delete(sessions)
  await db.delete(users).where(eq(users.email, 'nova@skola.cz'))
})

describe('zakládání účtů', () => {
  it('nový účet dostane jednorázové heslo a hned si ho musí změnit', async () => {
    const response = await zalozit(
      jsonReq('/api/sprava/uzivatele', 'POST', {
        email: 'Nova@Skola.cz',
        name: 'Nová učitelka',
        role: 'ucitelka',
      }),
    )
    expect(response.status).toBe(200)
    const { heslo, id } = (await response.json()) as { heslo: string; id: string }
    expect(heslo).toBeTruthy()

    const [ucet] = await db.select().from(users).where(eq(users.id, id))
    // E-mail se ukládá malými písmeny, jinak by se jeden účet dal založit dvakrát.
    expect(ucet?.email).toBe('nova@skola.cz')
    expect(ucet?.mustChangePassword).toBe(true)
    await expect(overitHeslo(heslo, ucet?.passwordHash ?? null)).resolves.toBe(true)
  })

  it('druhý účet s týmž e-mailem se odmítne s vysvětlením', async () => {
    await zalozit(
      jsonReq('/api/sprava/uzivatele', 'POST', { email: 'nova@skola.cz', name: 'Nová' }),
    )
    const druhy = await zalozit(
      jsonReq('/api/sprava/uzivatele', 'POST', { email: 'nova@skola.cz', name: 'Nová podruhé' }),
    )
    expect(druhy.status).toBe(409)
    await expect(druhy.json()).resolves.toMatchObject({ error: expect.stringContaining('už existuje') })
  })

  it('seznam ukazuje účty školy a nikdy otisk hesla', async () => {
    const response = await seznam()
    const { uzivatele } = (await response.json()) as {
      uzivatele: { email: string; maHeslo: boolean }[]
    }
    expect(uzivatele.some((radek) => radek.email === UCET.email)).toBe(true)
    expect(JSON.stringify(uzivatele)).not.toContain('scrypt$')
  })
})

describe('úprava účtů', () => {
  it('reset hesla vrátí nové heslo a odhlásí otevřená okna', async () => {
    const ucet = await seedUcet()
    await db.insert(sessions).values({
      id: 'relace-k-odvolani',
      userId: ucet.userId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    const response = await upravit(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: ucet.userId, heslo: true }),
    )
    const { heslo } = (await response.json()) as { heslo: string }
    expect(heslo).toBeTruthy()

    const [radek] = await db.select().from(users).where(eq(users.id, ucet.userId))
    expect(radek?.mustChangePassword).toBe(true)
    await expect(overitHeslo(heslo, radek?.passwordHash ?? null)).resolves.toBe(true)
    // Zvýšené číslo relace zneplatní i cookie, které někde zůstaly.
    expect(radek?.sessionVersion).toBe(2)

    const [relace] = await db.select().from(sessions).where(eq(sessions.id, 'relace-k-odvolani'))
    expect(relace?.revokedAt).not.toBeNull()
  })

  it('zablokování účet nemaže, jen mu vezme přístup', async () => {
    const ucet = await seedUcet()
    const response = await zablokovat(req(`/api/sprava/uzivatele?id=${ucet.userId}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)

    const [radek] = await db.select().from(users).where(eq(users.id, ucet.userId))
    // Účet zůstává: visí na něm autorství otázek i písemek.
    expect(radek?.status).toBe('zablokovany')
  })

  it('posledního správce nejde degradovat ani zablokovat', async () => {
    const response = await upravit(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: UCET.userId, role: 'ucitelka' }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('poslední správce'),
    })
  })

  it('sebe zablokovat nejde', async () => {
    const response = await zablokovat(req(`/api/sprava/uzivatele?id=${UCET.userId}`, { method: 'DELETE' }))
    expect(response.status).toBe(409)
  })
})

describe('role administrátora se v aplikaci nepřiděluje', () => {
  it('nový účet s rolí administrátora se odmítne', async () => {
    const response = await zalozit(
      jsonReq('/api/sprava/uzivatele', 'POST', {
        email: 'nova@skola.cz',
        name: 'Nová',
        role: 'administrator',
      }),
    )
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe(
      'Tuhle roli v aplikaci přidělit nejde.',
    )
  })

  it('změna role na administrátora se odmítne', async () => {
    const kolegyne = await seedUcet()
    const response = await upravit(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: kolegyne.userId, role: 'administrator' }),
    )
    expect(response.status).toBe(400)
    const [ucet] = await db.select().from(users).where(eq(users.id, kolegyne.userId))
    expect(ucet?.role).toBe('ucitelka')
  })

  it('administrátorský účet správce nezmění ani nezablokuje', async () => {
    const admin = await seedUcet({ role: 'administrator' })
    const zmena = await upravit(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: admin.userId, heslo: true }),
    )
    expect(zmena.status).toBe(403)
    expect(((await zmena.json()) as { error: string }).error).toBe(
      'Administrátorský účet se mění jen skriptem.',
    )
    const blok = await zablokovat(req(`/api/sprava/uzivatele?id=${admin.userId}`, { method: 'DELETE' }))
    expect(blok.status).toBe(403)
  })
})
