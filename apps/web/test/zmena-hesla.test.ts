import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as zmenit } from '@/app/api/zmena-hesla/route'
import { db, users } from '@/db'
import { overitHeslo, zahesovat } from '@/lib/heslo'
import { jsonReq, UCET } from './helpers'

/** Změna vlastního hesla — chce i to dosavadní a po sobě odvolá relace. */
beforeEach(async () => {
  await db
    .update(users)
    .set({ passwordHash: await zahesovat('puvodni-heslo'), mustChangePassword: true })
    .where(eq(users.id, UCET.userId))
})

describe('změna vlastního hesla', () => {
  it('se správným dosavadním heslem projde a příznak „změň si heslo" zmizí', async () => {
    const response = await zmenit(
      jsonReq('/api/zmena-hesla', 'POST', { stare: 'puvodni-heslo', nove: 'nove-dlouhe-heslo' }),
    )
    expect(response.status).toBe(200)

    const [ucet] = await db.select().from(users).where(eq(users.id, UCET.userId))
    await expect(overitHeslo('nove-dlouhe-heslo', ucet?.passwordHash ?? null)).resolves.toBe(true)
    expect(ucet?.mustChangePassword).toBe(false)
  })

  it('bez dosavadního hesla se nic nezmění', async () => {
    const response = await zmenit(
      jsonReq('/api/zmena-hesla', 'POST', { stare: 'uhodnuto', nove: 'nove-dlouhe-heslo' }),
    )
    expect(response.status).toBe(401)

    const [ucet] = await db.select().from(users).where(eq(users.id, UCET.userId))
    await expect(overitHeslo('puvodni-heslo', ucet?.passwordHash ?? null)).resolves.toBe(true)
  })

  it('krátké heslo se odmítne dřív, než se čte to dosavadní', async () => {
    const response = await zmenit(
      jsonReq('/api/zmena-hesla', 'POST', { stare: 'puvodni-heslo', nove: 'krátké' }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('znaků') })
  })
})
