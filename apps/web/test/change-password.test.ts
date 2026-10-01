import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as change } from '@/app/api/zmena-hesla/route'
import { db, users } from '@/db'
import { verifyPassword, hashPassword } from '@/lib/password'
import { jsonReq, ACCOUNT } from './helpers'

/** Changing one's own password — requires the current one and revokes sessions afterwards. */
beforeEach(async () => {
  await db
    .update(users)
    .set({ passwordHash: await hashPassword('puvodni-heslo'), mustChangePassword: true })
    .where(eq(users.id, ACCOUNT.userId))
})

describe('changing one\'s own password', () => {
  it('passes with the correct current password and the "change your password" flag disappears', async () => {
    const response = await change(
      jsonReq('/api/zmena-hesla', 'POST', { oldPassword: 'puvodni-heslo', newPassword: 'nove-dlouhe-heslo' }),
    )
    expect(response.status).toBe(200)

    const [account] = await db.select().from(users).where(eq(users.id, ACCOUNT.userId))
    await expect(verifyPassword('nove-dlouhe-heslo', account?.passwordHash ?? null)).resolves.toBe(true)
    expect(account?.mustChangePassword).toBe(false)
  })

  it('changes nothing without the current password', async () => {
    const response = await change(
      jsonReq('/api/zmena-hesla', 'POST', { oldPassword: 'uhodnuto', newPassword: 'nove-dlouhe-heslo' }),
    )
    expect(response.status).toBe(401)

    const [account] = await db.select().from(users).where(eq(users.id, ACCOUNT.userId))
    await expect(verifyPassword('puvodni-heslo', account?.passwordHash ?? null)).resolves.toBe(true)
  })

  it('rejects a short password before the current one is read', async () => {
    const response = await change(
      jsonReq('/api/zmena-hesla', 'POST', { oldPassword: 'puvodni-heslo', newPassword: 'krátké' }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('znaků') })
  })
})
