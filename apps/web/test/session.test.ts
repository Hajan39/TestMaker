import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  authMode,
  clearLoginAttempts,
  maPravo,
  overitRelaci,
  podepsatRelaci,
  recordLoginAttempt,
  type Relace,
} from '@/lib/session'

const SECRET = 'tajemstvi-na-podpis'

function relace(zmeny: Partial<Relace> = {}): Omit<Relace, 'v'> {
  return {
    uid: 'ucet-1',
    sch: 'skola-1',
    sid: 'relace-1',
    role: 'ucitelka',
    sv: 1,
    exp: Date.now() + 60_000,
    ...zmeny,
  }
}

describe('podepsaná cookie relace', () => {
  it('co se podepsalo, to se dá přečíst zpátky', async () => {
    const token = await podepsatRelaci(relace(), SECRET)
    const precteno = await overitRelaci(token, SECRET)
    expect(precteno?.uid).toBe('ucet-1')
    expect(precteno?.sid).toBe('relace-1')
    expect(precteno?.role).toBe('ucitelka')
  })

  it('odmítne podvržený obsah', async () => {
    const token = await podepsatRelaci(relace(), SECRET)
    const [obsah, podpis] = token.split('.')
    const podvrh = `${Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(obsah!, 'base64url').toString()), role: 'spravce' }),
    ).toString('base64url')}.${podpis}`
    await expect(overitRelaci(podvrh, SECRET)).resolves.toBeNull()
  })

  it('odmítne cizí tajemství, nesmysl i chybějící cookie', async () => {
    const token = await podepsatRelaci(relace(), SECRET)
    await expect(overitRelaci(token, 'jine-tajemstvi')).resolves.toBeNull()
    await expect(overitRelaci('nesmysl', SECRET)).resolves.toBeNull()
    await expect(overitRelaci(undefined, SECRET)).resolves.toBeNull()
    await expect(overitRelaci(token, '')).resolves.toBeNull()
  })

  it('vypršelou relaci nepustí, i když je podpis v pořádku', async () => {
    const token = await podepsatRelaci(relace({ exp: Date.now() - 1 }), SECRET)
    await expect(overitRelaci(token, SECRET)).resolves.toBeNull()
  })
})

describe('co která role smí', () => {
  const ucitelka = { ...relace(), v: 1 } as Relace
  const spravce = { ...relace({ role: 'spravce' }), v: 1 } as Relace
  const nahled = { ...relace({ role: 'nahled' }), v: 1 } as Relace
  const administrator = { ...relace({ role: 'administrator' }), v: 1 } as Relace

  it('do správy pustí jen správce a administrátora', () => {
    expect(maPravo(spravce, '/sprava/uzivatele', 'GET')).toBe(true)
    expect(maPravo(administrator, '/sprava', 'GET')).toBe(true)
    expect(maPravo(administrator, '/api/sprava/skola', 'PATCH')).toBe(true)
    expect(maPravo(ucitelka, '/sprava/uzivatele', 'GET')).toBe(false)
    expect(maPravo(ucitelka, '/api/sprava/uzivatele', 'POST')).toBe(false)
    // Podobný začátek cesty není správa.
    expect(maPravo(ucitelka, '/spravana', 'GET')).toBe(true)
  })

  it('do administrace škol pustí jedině administrátora', () => {
    expect(maPravo(administrator, '/administrace', 'GET')).toBe(true)
    expect(maPravo(administrator, '/api/administrace/skoly', 'POST')).toBe(true)
    expect(maPravo(spravce, '/administrace', 'GET')).toBe(false)
    expect(maPravo(spravce, '/api/administrace/skola', 'POST')).toBe(false)
    expect(maPravo(ucitelka, '/api/administrace/skoly', 'GET')).toBe(false)
  })

  it('náhled smí číst a tisknout, ale nic měnit', () => {
    expect(maPravo(nahled, '/api/tests/abc/pdf', 'GET')).toBe(true)
    expect(maPravo(nahled, '/questions', 'GET')).toBe(true)
    expect(maPravo(nahled, '/api/questions', 'POST')).toBe(false)
    expect(maPravo(nahled, '/api/library', 'DELETE')).toBe(false)
  })

  it('pracovní listy: náhled je čte, generovat a měnit je smí jen učitelka', () => {
    expect(maPravo(nahled, '/listy', 'GET')).toBe(true)
    expect(maPravo(nahled, '/listy/abc', 'GET')).toBe(true)
    expect(maPravo(nahled, '/api/worksheets/generate', 'POST')).toBe(false)
    expect(maPravo(nahled, '/api/worksheets/abc/items/x/regenerate', 'POST')).toBe(false)
    expect(maPravo(ucitelka, '/api/worksheets/generate', 'POST')).toBe(true)
    expect(maPravo(ucitelka, '/listy/new', 'GET')).toBe(true)
  })

  it('učitelka smí pracovat s obsahem', () => {
    expect(maPravo(ucitelka, '/api/questions', 'POST')).toBe(true)
    expect(maPravo(ucitelka, '/api/generate', 'POST')).toBe(true)
  })

  it('kdo má vynucenou změnu hesla, nedostane se nikam jinam', () => {
    const musi = { ...relace({ zh: true }), v: 1 } as Relace
    expect(maPravo(musi, '/zmena-hesla', 'GET')).toBe(true)
    expect(maPravo(musi, '/api/zmena-hesla', 'POST')).toBe(true)
    expect(maPravo(musi, '/api/logout', 'POST')).toBe(true)
    expect(maPravo(musi, '/questions', 'GET')).toBe(false)
  })
})

describe('rozhodnutí, jestli se přihlašuje', () => {
  it('s tajemstvím je přihlašování zapnuté', () => {
    expect(authMode({ AUTH_SECRET: 'secret' })).toBe('zapnuto')
    expect(authMode({ AUTH_SECRET: 'secret', VERCEL: '1' })).toBe('zapnuto')
  })

  it('bez tajemství mimo nasazení běží aplikace nechráněná (lokální vývoj a testy)', () => {
    expect(authMode({})).toBe('vypnuto')
    expect(authMode({ AUTH_SECRET: '' })).toBe('vypnuto')
  })

  it('bez tajemství v nasazení je to chyba nastavení, ne tichý běh dokořán', () => {
    expect(authMode({ VERCEL: '1' })).toBe('chybne-nastaveno')
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

  it('počítá každému účtu a adrese zvlášť', () => {
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
