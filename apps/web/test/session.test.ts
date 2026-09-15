import { describe, expect, it } from 'vitest'
import { isValidSession, sessionToken } from '@/lib/session'

describe('podpis přihlašovací cookie', () => {
  it('ze stejného hesla a tajemství vyrobí stejnou hodnotu', async () => {
    const a = await sessionToken('tajneheslo', 'secret')
    const b = await sessionToken('tajneheslo', 'secret')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('jiné tajemství dá jinou hodnotu', async () => {
    const a = await sessionToken('tajneheslo', 'secret')
    const b = await sessionToken('tajneheslo', 'jine-secret')
    expect(a).not.toBe(b)
  })

  it('přijme vlastní podpis', async () => {
    const value = await sessionToken('tajneheslo', 'secret')
    await expect(isValidSession(value, 'tajneheslo', 'secret')).resolves.toBe(true)
  })

  it('odmítne cizí hodnotu, prázdnou hodnotu i chybějící cookie', async () => {
    await expect(isValidSession('podvrh', 'tajneheslo', 'secret')).resolves.toBe(false)
    await expect(isValidSession('', 'tajneheslo', 'secret')).resolves.toBe(false)
    await expect(isValidSession(undefined, 'tajneheslo', 'secret')).resolves.toBe(false)
  })

  it('odmítne podpis vyrobený jiným heslem', async () => {
    const value = await sessionToken('stareheslo', 'secret')
    await expect(isValidSession(value, 'noveheslo', 'secret')).resolves.toBe(false)
  })
})
