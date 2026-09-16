import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  authMode,
  clearLoginAttempts,
  isValidSession,
  recordLoginAttempt,
  sessionToken,
} from '@/lib/session'

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

describe('rozhodnutí, jestli se přihlašuje', () => {
  it('s heslem i tajemstvím je přihlašování zapnuté', () => {
    expect(authMode({ APP_PASSWORD: 'tajneheslo', AUTH_SECRET: 'secret' })).toBe('zapnuto')
    // Ani na Vercelu na tom nic nemění — je nastaveno, co má být.
    expect(authMode({ APP_PASSWORD: 'tajneheslo', AUTH_SECRET: 'secret', VERCEL: '1' })).toBe(
      'zapnuto',
    )
  })

  it('bez hesla mimo nasazení běží aplikace nechráněná (lokální vývoj a testy)', () => {
    expect(authMode({})).toBe('vypnuto')
    expect(authMode({ APP_PASSWORD: '', AUTH_SECRET: '' })).toBe('vypnuto')
  })

  it('bez hesla v nasazení je to chyba nastavení, ne tichý běh dokořán', () => {
    expect(authMode({ VERCEL: '1' })).toBe('chybne-nastaveno')
    expect(authMode({ VERCEL: '1', AUTH_SECRET: 'secret' })).toBe('chybne-nastaveno')
  })

  it('heslo bez tajemství je chyba nastavení všude — přihlásit by se nešlo', () => {
    expect(authMode({ APP_PASSWORD: 'tajneheslo' })).toBe('chybne-nastaveno')
  })
})

describe('omezení pokusů o přihlášení', () => {
  beforeEach(() => clearLoginAttempts())

  it('pustí deset pokusů a jedenáctý odmítne', () => {
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(recordLoginAttempt('1.2.3.4').allowed).toBe(true)
    }
    const blocked = recordLoginAttempt('1.2.3.4')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000)
  })

  it('počítá každé adrese zvlášť', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i += 1) recordLoginAttempt('1.2.3.4', start)
    expect(recordLoginAttempt('5.6.7.8', start).allowed).toBe(true)
  })

  it('po patnácti minutách začne počítat znovu', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS + 1; i += 1) recordLoginAttempt('1.2.3.4', start)
    expect(recordLoginAttempt('1.2.3.4', start + LOGIN_WINDOW_MS - 1).allowed).toBe(false)
    expect(recordLoginAttempt('1.2.3.4', start + LOGIN_WINDOW_MS).allowed).toBe(true)
  })

  it('úspěšné přihlášení počítadlo smaže', () => {
    const start = Date.now()
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) recordLoginAttempt('1.2.3.4', start)
    clearLoginAttempts('1.2.3.4')
    expect(recordLoginAttempt('1.2.3.4', start).allowed).toBe(true)
  })
})
