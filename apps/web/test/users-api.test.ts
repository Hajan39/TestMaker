import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  DELETE as blockUser,
  GET as list,
  PATCH as update,
  POST as create,
} from '@/app/api/sprava/uzivatele/route'
import { db, sessions, users } from '@/db'
import { verifyPassword } from '@/lib/password'
import { jsonReq, req, seedAccount, ACCOUNT } from './helpers'

/**
 * Account management. Tested by calling the route handlers directly; sign-in is
 * disabled in tests, so everything runs under the default manager (`ACCOUNT`).
 */

beforeEach(async () => {
  await db.delete(sessions)
  await db.delete(users).where(eq(users.email, 'nova@skola.cz'))
})

describe('creating accounts', () => {
  it('a new account gets a one-time password and must change it right away', async () => {
    const response = await create(
      jsonReq('/api/sprava/uzivatele', 'POST', {
        email: 'Nova@Skola.cz',
        name: 'Nová učitelka',
        role: 'ucitelka',
      }),
    )
    expect(response.status).toBe(200)
    const { password, id } = (await response.json()) as { password: string; id: string }
    expect(password).toBeTruthy()

    const [account] = await db.select().from(users).where(eq(users.id, id))
    // The e-mail is stored lowercase, otherwise one account could be created twice.
    expect(account?.email).toBe('nova@skola.cz')
    expect(account?.mustChangePassword).toBe(true)
    await expect(verifyPassword(password, account?.passwordHash ?? null)).resolves.toBe(true)
  })

  it('rejects a second account with the same e-mail with an explanation', async () => {
    await create(
      jsonReq('/api/sprava/uzivatele', 'POST', { email: 'nova@skola.cz', name: 'Nová' }),
    )
    const second = await create(
      jsonReq('/api/sprava/uzivatele', 'POST', { email: 'nova@skola.cz', name: 'Nová podruhé' }),
    )
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({ error: expect.stringContaining('už existuje') })
  })

  it('the list shows the school\u0027s accounts and never a password hash', async () => {
    const response = await list()
    const { users: accounts } = (await response.json()) as {
      users: { email: string; hasPassword: boolean }[]
    }
    expect(accounts.some((row) => row.email === ACCOUNT.email)).toBe(true)
    expect(JSON.stringify(accounts)).not.toContain('scrypt$')
  })
})

describe('editing accounts', () => {
  it('a password reset returns a new password and signs out open windows', async () => {
    const account = await seedAccount()
    await db.insert(sessions).values({
      id: 'relace-k-odvolani',
      userId: account.userId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    const response = await update(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: account.userId, password: true }),
    )
    const { password } = (await response.json()) as { password: string }
    expect(password).toBeTruthy()

    const [row] = await db.select().from(users).where(eq(users.id, account.userId))
    expect(row?.mustChangePassword).toBe(true)
    await expect(verifyPassword(password, row?.passwordHash ?? null)).resolves.toBe(true)
    // The bumped session version invalidates cookies left anywhere as well.
    expect(row?.sessionVersion).toBe(2)

    const [session] = await db.select().from(sessions).where(eq(sessions.id, 'relace-k-odvolani'))
    expect(session?.revokedAt).not.toBeNull()
  })

  it('blocking does not delete the account, it only revokes access', async () => {
    const account = await seedAccount()
    const response = await blockUser(req(`/api/sprava/uzivatele?id=${account.userId}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)

    const [row] = await db.select().from(users).where(eq(users.id, account.userId))
    // The account stays: authorship of questions and tests hangs on it.
    expect(row?.status).toBe('zablokovany')
  })

  it('the last manager cannot be demoted or blocked', async () => {
    const response = await update(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: ACCOUNT.userId, role: 'ucitelka' }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('poslední správce'),
    })
  })

  it('cannot block oneself', async () => {
    const response = await blockUser(req(`/api/sprava/uzivatele?id=${ACCOUNT.userId}`, { method: 'DELETE' }))
    expect(response.status).toBe(409)
  })
})

describe('the administrator role is not assigned in the app', () => {
  it('rejects a new account with the administrator role', async () => {
    const response = await create(
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

  it('rejects changing the role to administrator', async () => {
    const colleague = await seedAccount()
    const response = await update(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: colleague.userId, role: 'administrator' }),
    )
    expect(response.status).toBe(400)
    const [account] = await db.select().from(users).where(eq(users.id, colleague.userId))
    expect(account?.role).toBe('ucitelka')
  })

  it('a manager can neither change nor block an administrator account', async () => {
    const admin = await seedAccount({ role: 'administrator' })
    const change = await update(
      jsonReq('/api/sprava/uzivatele', 'PATCH', { id: admin.userId, password: true }),
    )
    expect(change.status).toBe(403)
    expect(((await change.json()) as { error: string }).error).toBe(
      'Administrátorský účet se mění jen skriptem.',
    )
    const block = await blockUser(req(`/api/sprava/uzivatele?id=${admin.userId}`, { method: 'DELETE' }))
    expect(block.status).toBe(403)
  })
})
