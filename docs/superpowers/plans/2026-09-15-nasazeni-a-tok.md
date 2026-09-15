# Nasaditelná verze a průchodnost toku — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikaci jde vystavit učitelce chráněnou heslem, generování doběhne bez otevřeného prohlížeče, knihovna se dá zazálohovat, a tři nejhorší místa toku (import naslepo, schvalování po jedné, nemožnost nahradit špatnou otázku) jsou průchodná.

**Architecture:** Next.js App Router. Ochrana přístupu je `middleware.ts` s jedním sdíleným heslem a podepsanou cookie (Web Crypto, běží v Edge runtime). Fronta generování dostane `GET` variantu pro plánovač. Nová čistá logika (podpis cookie, náhled importu, fronta schvalování) jde do `apps/web/src/lib/*` jako funkce bez závislosti na Reactu ani na databázi, aby šla otestovat.

**Tech Stack:** Next.js 16, React 19, drizzle-orm nad `@libsql/client` (SQLite/Turso), zod 4, vitest 5, Tailwind 4, `ai` SDK s Anthropic providerem.

**Spec:** `docs/superpowers/specs/2026-09-15-nasazeni-a-tok-design.md`

## Global Constraints

- Projekt je celý česky **včetně komentářů v kódu**. Commit messages anglicky podle Conventional Commits.
- Tvar otázky, šablony i testu určuje zod v `packages/core/src/schema`. Druhá definice téhož se nikde nezavádí.
- Extrakce textu běží v prohlížeči. Na server jde jen text, nikdy originální soubory (limit požadavku na Vercelu je 4,5 MB).
- Vykreslení PDF patří do `packages/core/src/pdf/node.ts`. Tento plán se PDF nedotýká.
- Bez API klíče se nepadá — když generování není nakonfigurované, rozhraní ho skryje a vysvětlí proč. Totéž platí pro nové cesty: bez `APP_PASSWORD` běží aplikace dál, jen nechráněná.
- Chybové hlášky jsou české a říkají, co s tím dělat. Čte je učitelka, ne vývojář.
- Ověřování po každém úkolu: `pnpm test`, `pnpm typecheck`, `pnpm build`.
- Nové čisté funkce patří do `apps/web/src/lib/` nebo `packages/core/src/`, ne do komponent — komponenta se netestuje, funkce ano.

---

### Task 1: Přihlášení jedním heslem a vzorový `.env.example`

Zavádí ochranu přístupu a spolu s ní testovací běh pro `apps/web`, který zatím neexistuje. Pokrývá A1 a A2 ze specifikace.

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/test/session.test.ts`
- Create: `apps/web/src/lib/session.ts`
- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/app/login/page.tsx`
- Create: `apps/web/src/app/api/login/route.ts`
- Create: `apps/web/.env.example`
- Modify: `apps/web/package.json` (skript `test`, devDependency `vitest`)
- Modify: `README.md` (oprava rychlého startu)

**Interfaces:**
- Consumes: nic z dřívějších úkolů.
- Produces:
  - `SESSION_COOKIE: string` — název cookie, hodnota `'tm_session'`.
  - `sessionToken(password: string, secret: string): Promise<string>` — HMAC-SHA256 hexem.
  - `isValidSession(value: string | undefined, password: string, secret: string): Promise<boolean>`.
  - `isAuthDisabled(): boolean` — true, když `APP_PASSWORD` není nastavené.

- [ ] **Step 1: Přidej vitest do `apps/web`**

Do `apps/web/package.json` doplň skript a devDependency:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint",
  "typecheck": "tsc --noEmit"
},
"devDependencies": {
  "vitest": "^5.0.0"
}
```

Zbytek `scripts` a `devDependencies` nech beze změny — přidávají se jen `test`, `test:watch` a `vitest`.

Vytvoř `apps/web/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

Nainstaluj: `pnpm install`

- [ ] **Step 2: Napiš padající test podpisu cookie**

Vytvoř `apps/web/test/session.test.ts`:

```ts
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
```

- [ ] **Step 3: Spusť test, ověř že padá**

Run: `pnpm --filter @testmaker/web test`
Expected: FAIL — `Failed to resolve import "@/lib/session"`.

- [ ] **Step 4: Napiš `apps/web/src/lib/session.ts`**

```ts
/**
 * Přihlášení jedním sdíleným heslem. Cookie nese HMAC-SHA256 z hesla
 * klíčem `AUTH_SECRET` — v cookie tedy heslo samotné není a bez tajemství
 * ji nikdo nevyrobí. Používá Web Crypto, protože `node:crypto` v Edge
 * runtime middlewaru není k dispozici.
 */
export const SESSION_COOKIE = 'tm_session'

const encoder = new TextEncoder()

export async function sessionToken(password: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function isValidSession(
  value: string | undefined,
  password: string,
  secret: string,
): Promise<boolean> {
  if (!value) return false
  return equalConstantTime(value, await sessionToken(password, secret))
}

/** Bez nastaveného hesla aplikace běží nechráněná — tak ji používáme lokálně. */
export function isAuthDisabled(): boolean {
  return !process.env.APP_PASSWORD
}

/** Porovnání nezávislé na délce shodné předpony, ať se podpis nedá uhodnout po znacích. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
```

- [ ] **Step 5: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS, 5 testů.

- [ ] **Step 6: Napiš middleware**

Vytvoř `apps/web/src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, isAuthDisabled, isValidSession } from '@/lib/session'

/** Statické soubory a favicon se neřeší, zbytek aplikace ano. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next()
  if (isAuthDisabled()) return NextResponse.next()

  // Plánovač se hlásí sdíleným tajemstvím; Vercel Cron posílá právě tuhle hlavičku.
  const cronSecret = process.env.CRON_SECRET
  if (
    pathname === '/api/jobs/run' &&
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next()
  }

  const ok = await isValidSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.APP_PASSWORD ?? '',
    process.env.AUTH_SECRET ?? '',
  )
  if (ok) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Nepřihlášeno' }, { status: 401 })
  }

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = ''
  return NextResponse.redirect(login)
}
```

- [ ] **Step 7: Napiš přihlašovací stránku a její API**

Vytvoř `apps/web/src/app/api/login/route.ts`:

```ts
import { z } from 'zod'
import { SESSION_COOKIE, sessionToken } from '@/lib/session'

export const runtime = 'nodejs'

const loginSchema = z.object({ password: z.string().min(1) })

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Vyplň heslo.' }, { status: 400 })
  }

  const password = process.env.APP_PASSWORD
  const secret = process.env.AUTH_SECRET
  if (!password || !secret) {
    return Response.json(
      { error: 'Přihlašování není nastavené — chybí APP_PASSWORD nebo AUTH_SECRET.' },
      { status: 503 },
    )
  }
  if (parsed.data.password !== password) {
    return Response.json({ error: 'Heslo nesouhlasí.' }, { status: 401 })
  }

  const response = Response.json({ ok: true })
  response.headers.append(
    'set-cookie',
    `${SESSION_COOKIE}=${await sessionToken(password, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  )
  return response
}
```

Vytvoř `apps/web/src/app/login/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, Label } from '@testmaker/ui'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    setBusy(false)
    if (!response.ok) {
      const detail = (await response.json()) as { error?: string }
      setError(detail.error ?? 'Přihlášení se nezdařilo.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <Card className="mx-auto mt-16 max-w-sm p-6">
      <h1 className="text-lg font-semibold text-ink-900">Přihlášení</h1>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <Label htmlFor="password">Heslo</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-danger-600">{error}</p> : null}
        <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
          Přihlásit se
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 8: Napiš `.env.example` a oprav README**

Vytvoř `apps/web/.env.example`:

```bash
# Databáze. Lokálně soubor, na Vercelu Turso (libsql://… + token).
DATABASE_URL=file:./local.db
DATABASE_AUTH_TOKEN=

# Klíč pro generování otázek. Bez něj aplikace běží dál, jen generování skryje.
ANTHROPIC_API_KEY=

# Sdílené heslo do aplikace. Prázdné = aplikace je bez přihlášení (jen lokálně!).
APP_PASSWORD=
# Tajemství pro podpis přihlašovací cookie. Vyrob: openssl rand -hex 32
AUTH_SECRET=

# Tajemství pro plánovač generování. Bez něj cron k frontě nepustíme.
CRON_SECRET=
```

V `README.md` v sekci Rychlý start uveď u `cp apps/web/.env.example apps/web/.env.local`, že se vedle `ANTHROPIC_API_KEY` doplní i `APP_PASSWORD` a `AUTH_SECRET`, pokud má aplikace běžet vystavená, a že prázdné `APP_PASSWORD` znamená běh bez přihlášení.

- [ ] **Step 9: Ověř celek**

Run: `pnpm test` — Expected: PASS ve všech balíčcích.
Run: `pnpm typecheck` — Expected: bez chyb.
Run: `pnpm build` — Expected: build projde, middleware se v souhrnu objeví.

- [ ] **Step 10: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/test/session.test.ts apps/web/src/lib/session.ts apps/web/src/middleware.ts apps/web/src/app/login apps/web/src/app/api/login apps/web/.env.example apps/web/package.json README.md pnpm-lock.yaml
git commit -m "feat: protect the app with a shared password"
```

---

### Task 2: Fronta generování běží i bez otevřeného prohlížeče

Pokrývá A3. Přidává `GET` variantu runneru pro plánovač a vrací zaseknuté úlohy zpátky do fronty.

**Files:**
- Create: `apps/web/test/jobs.test.ts`
- Create: `apps/web/src/lib/jobs.ts`
- Create: `vercel.json`
- Modify: `apps/web/src/app/api/jobs/run/route.ts`

**Interfaces:**
- Consumes: `CRON_SECRET` z Tasku 1 (middleware ho už propouští na `/api/jobs/run` v hlavičce `authorization`).
- Produces:
  - `STALE_AFTER_MINUTES: number` — hodnota `10`.
  - `staleBefore(now: Date, minutes?: number): string` — ISO čas, před kterým je běžící úloha zaseknutá.

- [ ] **Step 1: Napiš padající test**

Vytvoř `apps/web/test/jobs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STALE_AFTER_MINUTES, staleBefore } from '@/lib/jobs'

describe('hranice zaseknuté úlohy', () => {
  it('vrací čas posunutý o limit do minulosti', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    expect(staleBefore(now)).toBe('2026-09-15T11:50:00.000Z')
  })

  it('úloha spuštěná před chvílí zaseknutá není, hodinu stará ano', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const cutoff = staleBefore(now)
    expect('2026-09-15T11:59:00.000Z' < cutoff).toBe(false)
    expect('2026-09-15T11:00:00.000Z' < cutoff).toBe(true)
  })

  it('limit jde přenastavit', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    expect(staleBefore(now, 30)).toBe('2026-09-15T11:30:00.000Z')
    expect(STALE_AFTER_MINUTES).toBe(10)
  })
})
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `pnpm --filter @testmaker/web test`
Expected: FAIL — `Failed to resolve import "@/lib/jobs"`.

- [ ] **Step 3: Napiš `apps/web/src/lib/jobs.ts`**

```ts
/**
 * Úloha, kterou si někdo vzal a nedoběhla, by ve stavu `running` uvízla navždy —
 * typicky proto, že se zavřel prohlížeč nebo vypršel časový limit funkce.
 * Po tomhle limitu ji další běh runneru vrátí do fronty.
 */
export const STALE_AFTER_MINUTES = 10

export function staleBefore(now: Date, minutes = STALE_AFTER_MINUTES): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString()
}
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS.

- [ ] **Step 5: Uprav runner**

V `apps/web/src/app/api/jobs/run/route.ts` nahraď hlavičku souboru a funkci `POST` tímto; funkce `remaining()` na konci souboru zůstává beze změny:

```ts
import { and, asc, eq, lt } from 'drizzle-orm'
import { isAiConfigured } from '@testmaker/core/ai'
import { db, generationJobs } from '@/db'
import { generateForTopic } from '@/lib/generation'
import { staleBefore } from '@/lib/jobs'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Zpracuje jednu úlohu z fronty. UI volá endpoint ve smyčce, dokud vrací
 * `remaining > 0` — díky tomu se vejdeme do časového limitu funkce i na Vercelu.
 */
export async function POST() {
  return runOne()
}

/** Totéž pro plánovač (Vercel Cron, cron na Synology). Middleware ho pouští podle CRON_SECRET. */
export async function GET() {
  return runOne()
}

async function runOne() {
  if (!isAiConfigured()) {
    return Response.json({ error: 'AI není nakonfigurovaná' }, { status: 503 })
  }

  await reclaimStaleJobs()

  const [job] = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, 'queued'))
    .orderBy(asc(generationJobs.createdAt))
    .limit(1)

  if (!job) return Response.json({ processed: false, remaining: 0 })
```

Zbytek těla (převzetí úlohy, `try`/`catch`, odpovědi) nech beze změny — jen se přesunul z `POST` do `runOne`.

Pod `remaining()` doplň:

```ts
/** Úlohy, které někdo začal a nedoběhly, vrátíme do fronty, ať se na ně nezapomene. */
async function reclaimStaleJobs(): Promise<void> {
  await db
    .update(generationJobs)
    .set({ status: 'queued', startedAt: null })
    .where(
      and(
        eq(generationJobs.status, 'running'),
        lt(generationJobs.startedAt, staleBefore(new Date())),
      ),
    )
}
```

- [ ] **Step 6: Přidej plánovač**

Vytvoř `vercel.json` v kořeni repozitáře:

```json
{
  "crons": [
    {
      "path": "/api/jobs/run",
      "schedule": "* * * * *"
    }
  ]
}
```

Do `README.md` doplň pod rychlý start odstavec: při self-hostingu (Synology) stejnou práci dělá naplánovaný příkaz
`curl -H "Authorization: Bearer $CRON_SECRET" https://<adresa>/api/jobs/run`, spouštěný po minutě.

- [ ] **Step 7: Ověř**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: vše projde.

- [ ] **Step 8: Commit**

```bash
git add apps/web/test/jobs.test.ts apps/web/src/lib/jobs.ts apps/web/src/app/api/jobs/run/route.ts vercel.json README.md
git commit -m "feat: run the generation queue from a scheduler and reclaim stale jobs"
```

---

### Task 3: Export a import celé knihovny

Pokrývá A4. Jeden JSON se vším, stažení a nahrání zpět.

**Files:**
- Create: `apps/web/test/libraryDump.test.ts`
- Create: `apps/web/test/setup.ts`
- Create: `apps/web/src/lib/libraryDump.ts`
- Create: `apps/web/src/app/api/export/route.ts`
- Modify: `apps/web/vitest.config.ts` (databáze v paměti pro testy)
- Modify: `apps/web/src/app/page.tsx` (odkaz na stažení zálohy)

**Interfaces:**
- Consumes: tabulky z `@/db` (`subjects`, `grades`, `topics`, `materials`, `questions`, `templates`, `tests`, `testItems`).
- Produces:
  - `libraryDumpSchema` — zod schéma celé zálohy.
  - `type LibraryDump = z.infer<typeof libraryDumpSchema>`.
  - `exportLibrary(): Promise<LibraryDump>`.
  - `importLibrary(dump: LibraryDump): Promise<{ [K in keyof LibraryDump['data']]: number }>`.

- [ ] **Step 1: Napiš padající test tvaru zálohy**

Vytvoř `apps/web/test/libraryDump.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { libraryDumpSchema } from '@/lib/libraryDump'

const minimal = {
  version: 1,
  exportedAt: '2026-09-15T10:00:00.000Z',
  data: {
    subjects: [{ id: 's1', name: 'Přírodopis', position: 0, createdAt: '2026-01-01T00:00:00.000Z' }],
    grades: [],
    topics: [],
    materials: [],
    questions: [],
    templates: [],
    tests: [],
    testItems: [],
  },
}

describe('schéma zálohy knihovny', () => {
  it('přijme zálohu se všemi tabulkami', () => {
    const parsed = libraryDumpSchema.parse(minimal)
    expect(parsed.data.subjects[0].name).toBe('Přírodopis')
  })

  it('odmítne zálohu, které chybí tabulka', () => {
    const broken = { ...minimal, data: { ...minimal.data, questions: undefined } }
    expect(libraryDumpSchema.safeParse(broken).success).toBe(false)
  })

  it('odmítne zálohu z novější verze formátu', () => {
    expect(libraryDumpSchema.safeParse({ ...minimal, version: 2 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `pnpm --filter @testmaker/web test`
Expected: FAIL — `Failed to resolve import "@/lib/libraryDump"`.

- [ ] **Step 3: Napiš `apps/web/src/lib/libraryDump.ts`**

```ts
import 'server-only'
import { z } from 'zod'
import { db, grades, materials, questions, subjects, templates, testItems, tests, topics } from '@/db'

/**
 * Celá knihovna v jednom souboru. Řádky se ukládají tak, jak jsou v databázi —
 * schéma je jen tvar zálohy, obsah otázek i šablon hlídá zod v core.
 */
const row = z.record(z.string(), z.unknown())

export const libraryDumpSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  data: z.object({
    subjects: z.array(row),
    grades: z.array(row),
    topics: z.array(row),
    materials: z.array(row),
    questions: z.array(row),
    templates: z.array(row),
    tests: z.array(row),
    testItems: z.array(row),
  }),
})

export type LibraryDump = z.infer<typeof libraryDumpSchema>

/** Pořadí je dané cizími klíči — nadřazené tabulky první. */
const TABLES = [
  ['subjects', subjects],
  ['grades', grades],
  ['topics', topics],
  ['materials', materials],
  ['questions', questions],
  ['templates', templates],
  ['tests', tests],
  ['testItems', testItems],
] as const

export async function exportLibrary(): Promise<LibraryDump> {
  const data = {} as LibraryDump['data']
  for (const [name, table] of TABLES) {
    data[name] = (await db.select().from(table)) as LibraryDump['data'][typeof name]
  }
  return { version: 1, exportedAt: new Date().toISOString(), data }
}

/** Nahraje zálohu zpět; záznam se stejným `id` se přepíše. */
export async function importLibrary(
  dump: LibraryDump,
): Promise<Record<keyof LibraryDump['data'], number>> {
  const counts = {} as Record<keyof LibraryDump['data'], number>
  for (const [name, table] of TABLES) {
    const rows = dump.data[name]
    counts[name] = rows.length
    for (const values of rows) {
      await db
        .insert(table)
        .values(values as never)
        .onConflictDoUpdate({ target: table.id, set: values as never })
    }
  }
  return counts
}
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS.

- [ ] **Step 5: Připrav testovací databázi v paměti**

V `apps/web/vitest.config.ts` doplň do bloku `test`:

```ts
    env: { DATABASE_URL: 'file::memory:?cache=shared' },
    setupFiles: ['./test/setup.ts'],
```

Vytvoř `apps/web/test/setup.ts`:

```ts
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

// Testy běží nad databází v paměti; sdílená cache znamená, že do ní vidí
// i klient, který si `@/db` vytvoří sám.
const client = createClient({ url: process.env.DATABASE_URL ?? 'file::memory:?cache=shared' })
await migrate(drizzle(client), { migrationsFolder: './drizzle' })
```

- [ ] **Step 6: Napiš padající test zálohy tam a zpět**

Do `apps/web/test/libraryDump.test.ts` přidej:

```ts
import { db, questions, subjects, grades, topics } from '@/db'
import { exportLibrary, importLibrary } from '@/lib/libraryDump'

describe('záloha tam a zpět', () => {
  it('po smazání a nahrání zálohy je knihovna stejná', async () => {
    await db.insert(subjects).values({ id: 's-rt', name: 'Přírodopis', position: 0 })
    await db.insert(grades).values({ id: 'g-rt', subjectId: 's-rt', name: '8. ročník', position: 0 })
    await db.insert(topics).values({ id: 't-rt', gradeId: 'g-rt', name: 'Buňka', position: 0 })
    await db.insert(questions).values({
      id: 'q-rt',
      topicId: 't-rt',
      type: 'single_choice',
      payload: { prompt: 'Co je buňka?', options: ['a', 'b'], correctIndex: 0 },
      points: 1,
      difficulty: 2,
    })

    const dump = await exportLibrary()
    await db.delete(questions)
    expect(await db.select().from(questions)).toHaveLength(0)

    await importLibrary(dump)
    const restored = await db.select().from(questions)
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('q-rt')
    expect(restored[0].payload).toEqual({ prompt: 'Co je buňka?', options: ['a', 'b'], correctIndex: 0 })
  })

  it('nahrání téže zálohy podruhé nic nezdvojí', async () => {
    const dump = await exportLibrary()
    await importLibrary(dump)
    await importLibrary(dump)
    expect(await db.select().from(questions)).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS. Pokud selže na chybějící tabulce, zkontroluj, že `setupFiles` běží před testy a že `drizzle/` obsahuje migrace.

- [ ] **Step 8: Napiš API zálohy**

Vytvoř `apps/web/src/app/api/export/route.ts`:

```ts
import { exportLibrary, importLibrary, libraryDumpSchema } from '@/lib/libraryDump'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Stažení celé knihovny jako jeden soubor. */
export async function GET() {
  const dump = await exportLibrary()
  const name = `testmaker-zaloha-${dump.exportedAt.slice(0, 10)}.json`
  return new Response(JSON.stringify(dump), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  })
}

/** Nahrání zálohy zpět. */
export async function POST(request: Request) {
  const parsed = libraryDumpSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: 'Tohle není záloha TestMakeru, nebo je z novější verze.' },
      { status: 400 },
    )
  }
  return Response.json({ restored: await importLibrary(parsed.data) })
}
```

- [ ] **Step 9: Přidej odkaz na přehled**

Do `apps/web/src/app/page.tsx` přidej do hlavičky stránky odkaz vedle stávajících akcí:

```tsx
<a href="/api/export" className="text-sm text-brand-700 hover:underline" download>
  Stáhnout zálohu
</a>
```

- [ ] **Step 10: Ověř zálohu naživo**

Run: `pnpm dev` a v druhém terminálu `curl -s http://localhost:3000/api/export | head -c 200`
Expected: JSON začínající `{"version":1,"exportedAt":`. Pokud je `APP_PASSWORD` nastavené, vrátí se místo toho 401 — to je správně, ověř přes přihlášený prohlížeč.

- [ ] **Step 11: Ověř a commitni**

Run: `pnpm test && pnpm typecheck && pnpm build`

```bash
git add apps/web/test/libraryDump.test.ts apps/web/test/setup.ts apps/web/vitest.config.ts apps/web/src/lib/libraryDump.ts apps/web/src/app/api/export apps/web/src/app/page.tsx
git commit -m "feat: export and restore the whole question library"
```

---

### Task 4: Stav otázky se začne používat při skládání testu

Pokrývá B4. Dnes `loadPickerTopics` stav nečte, takže schvalování nemá žádný účinek.

**Files:**
- Modify: `apps/web/src/lib/questionPicker.ts:20-35`
- Create: `apps/web/drizzle/0001_approve_existing_drafts.sql` (vygeneruje drizzle-kit)

**Interfaces:**
- Consumes: `loadPickerTopics(): Promise<PickerTopic[]>` — signatura se nemění.
- Produces: tatáž signatura, ale vrací jen otázky se stavem `approved`.

- [ ] **Step 1: Vygeneruj prázdnou migraci**

Run: `pnpm --filter @testmaker/web exec drizzle-kit generate --custom --name=approve_existing_drafts`
Expected: vznikne `apps/web/drizzle/0001_approve_existing_drafts.sql` a zapíše se do `drizzle/meta`.

- [ ] **Step 2: Napiš obsah migrace**

Do vygenerovaného souboru napiš:

```sql
-- Dosud se stav otázky při skládání testu neuplatňoval a všechny vygenerované
-- otázky zůstávaly v konceptu. Aby dnešní banka nezmizela z výběru, překlopí se
-- existující koncepty na schválené; zamítnuté zůstávají zamítnuté.
UPDATE questions SET status = 'approved' WHERE status = 'draft';
```

- [ ] **Step 3: Spusť migraci**

Run: `pnpm db:migrate`
Expected: proběhne bez chyby.

- [ ] **Step 4: Uprav výběr otázek**

V `apps/web/src/lib/questionPicker.ts` uprav import a dotaz:

```ts
import { and, asc, eq } from 'drizzle-orm'
```

a do dotazu doplň podmínku (nahradí stávající `.innerJoin(...).orderBy(...)` řetěz na místě za posledním joinem):

```ts
    .where(eq(questions.status, 'approved'))
    .orderBy(asc(subjects.name), asc(grades.position), asc(topics.name), asc(questions.createdAt))
```

Nad `loadPickerTopics` uprav komentář:

```ts
/**
 * Schválené otázky seskupené podle tématu pro výběr do testu.
 * Koncepty a zamítnuté se nenabízejí — na to je obrazovka schvalování.
 * Test se skládá napříč předměty i ročníky, proto se načítá celá knihovna.
 */
```

Pokud je `and` po úpravě nepoužité, import zase zúž na `asc, eq`.

- [ ] **Step 5: Ověř naživo**

Run: `pnpm dev`, otevři `/tests/new`
Expected: nabízejí se otázky. Změň v tématu jednu otázku na „zamítnuto“ a obnov `/tests/new` — musí zmizet z nabídky.

- [ ] **Step 6: Ověř a commitni**

Run: `pnpm test && pnpm typecheck && pnpm build`

```bash
git add apps/web/src/lib/questionPicker.ts apps/web/drizzle
git commit -m "fix: offer only approved questions when composing a test"
```

---

### Task 5: Náhled importu před uložením

Pokrývá B1. Mezi extrakci a odeslání se vloží krok, kde jde opravit odhadnuté Předmět / Ročník / Téma.

**Files:**
- Create: `apps/web/test/importPreview.test.ts`
- Create: `apps/web/src/lib/importPreview.ts`
- Modify: `apps/web/src/app/import/ImportClient.tsx`

**Interfaces:**
- Consumes: `ExtractedMaterial` z `@testmaker/core/schema`.
- Produces:
  - `interface PreviewGroup { key: string; subject: string; grade: string | null; topic: string; include: boolean; materials: ExtractedMaterial[] }`
  - `buildPreviewGroups(materials: ExtractedMaterial[]): PreviewGroup[]`
  - `applyPreviewGroups(groups: PreviewGroup[]): ExtractedMaterial[]`

- [ ] **Step 1: Napiš padající test**

Vytvoř `apps/web/test/importPreview.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { applyPreviewGroups, buildPreviewGroups } from '@/lib/importPreview'

function material(overrides: Partial<ExtractedMaterial>): ExtractedMaterial {
  return {
    relativePath: 'Přírodopis/8. ročník/Buňka.pdf',
    fileName: 'Buňka.pdf',
    subject: 'Přírodopis',
    grade: '8. ročník',
    topic: 'Buňka',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    text: 'text',
    pageCount: 3,
    needsOcr: false,
    contentHash: 'hash-1',
    ...overrides,
  }
}

describe('skupiny pro náhled importu', () => {
  it('spojí soubory téhož tématu do jedné skupiny', () => {
    const groups = buildPreviewGroups([
      material({ contentHash: 'a' }),
      material({ contentHash: 'b', fileName: 'Buňka-PL.pdf' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].materials).toHaveLength(2)
    expect(groups[0].topic).toBe('Buňka')
    expect(groups[0].include).toBe(true)
  })

  it('rozdělí skupiny podle předmětu, ročníku i tématu', () => {
    const groups = buildPreviewGroups([
      material({ contentHash: 'a' }),
      material({ contentHash: 'b', grade: '9. ročník' }),
      material({ contentHash: 'c', topic: 'Tkáně' }),
    ])
    expect(groups).toHaveLength(3)
  })

  it('řadí skupiny česky podle předmětu, ročníku a tématu', () => {
    const groups = buildPreviewGroups([
      material({ contentHash: 'a', topic: 'Žaludek' }),
      material({ contentHash: 'b', topic: 'Cévy' }),
    ])
    expect(groups.map((group) => group.topic)).toEqual(['Cévy', 'Žaludek'])
  })

  it('přepíše materiálům názvy podle upravené skupiny', () => {
    const groups = buildPreviewGroups([material({ contentHash: 'a' })])
    groups[0].subject = 'Biologie'
    groups[0].grade = null
    groups[0].topic = 'Stavba buňky'

    const [result] = applyPreviewGroups(groups)
    expect(result.subject).toBe('Biologie')
    expect(result.grade).toBeNull()
    expect(result.topic).toBe('Stavba buňky')
  })

  it('vynechá skupiny, které učitelka odškrtla', () => {
    const groups = buildPreviewGroups([
      material({ contentHash: 'a' }),
      material({ contentHash: 'b', topic: 'Tkáně' }),
    ])
    groups[0].include = false
    expect(applyPreviewGroups(groups)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `pnpm --filter @testmaker/web test`
Expected: FAIL — `Failed to resolve import "@/lib/importPreview"`.

- [ ] **Step 3: Napiš `apps/web/src/lib/importPreview.ts`**

```ts
import type { ExtractedMaterial } from '@testmaker/core/schema'

/**
 * Předmět, ročník a téma se odhadují z cesty v souboru (`parsePath`) a odhad
 * sedí jen tehdy, když má složka tvar Předmět → Ročník → Téma. Než se cokoli
 * uloží, ukážeme výsledek učitelce a necháme ji ho opravit.
 */
export interface PreviewGroup {
  key: string
  subject: string
  grade: string | null
  topic: string
  include: boolean
  materials: ExtractedMaterial[]
}

export function buildPreviewGroups(materials: ExtractedMaterial[]): PreviewGroup[] {
  const groups = new Map<string, PreviewGroup>()

  for (const material of materials) {
    const key = JSON.stringify([material.subject, material.grade, material.topic])
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        subject: material.subject,
        grade: material.grade,
        topic: material.topic,
        include: true,
        materials: [],
      }
      groups.set(key, group)
    }
    group.materials.push(material)
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.subject.localeCompare(b.subject, 'cs') ||
      (a.grade ?? '').localeCompare(b.grade ?? '', 'cs') ||
      a.topic.localeCompare(b.topic, 'cs'),
  )
}

/** Materiály zařazených skupin s názvy přepsanými podle úprav v náhledu. */
export function applyPreviewGroups(groups: PreviewGroup[]): ExtractedMaterial[] {
  return groups
    .filter((group) => group.include)
    .flatMap((group) =>
      group.materials.map((material) => ({
        ...material,
        subject: group.subject,
        grade: group.grade,
        topic: group.topic,
      })),
    )
}
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS, 5 testů.

- [ ] **Step 5: Zapoj náhled do `ImportClient.tsx`**

V `apps/web/src/app/import/ImportClient.tsx`:

1. Doplň importy:

```tsx
import { Checkbox, Input } from '@testmaker/ui'
import { applyPreviewGroups, buildPreviewGroups, type PreviewGroup } from '@/lib/importPreview'
```

2. Nahraď stav `materials` a odvozené `grouped` skupinami:

```tsx
  const [groups, setGroups] = useState<PreviewGroup[]>([])

  const plannedCount = useMemo(
    () => groups.filter((group) => group.include).reduce((sum, group) => sum + group.materials.length, 0),
    [groups],
  )

  function updateGroup(key: string, patch: Partial<PreviewGroup>) {
    setGroups((current) =>
      current.map((group) => (group.key === key ? { ...group, ...patch } : group)),
    )
  }
```

3. V `handleFiles` nahraď `setMaterials([])` za `setGroups([])` a závěrečné `setMaterials(extracted)` za `setGroups(buildPreviewGroups(extracted))`.

4. V `handleUpload` nahraď `uploadMaterials(materials, …)` za:

```tsx
      const result = await uploadMaterials(applyPreviewGroups(groups), (done, total) =>
        setProgress({ done, total }),
      )
```

5. Nahraď blok `{materials.length > 0 && phase !== 'done' ? … : null}` náhledem:

```tsx
      {groups.length > 0 && phase !== 'done' ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">
                Připraveno k importu: {plannedCount} souborů v {groups.filter((g) => g.include).length} tématech
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Názvy jsou odhadnuté z názvů složek a souborů. Co nesedí, přepiš — uloží se to,
                co je vidět tady.
              </p>
            </div>
            <Button variant="primary" disabled={busy || plannedCount === 0} onClick={() => void handleUpload()}>
              Naimportovat
            </Button>
          </div>

          <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.key} className="rounded border border-ink-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox
                    checked={group.include}
                    onChange={(event) => updateGroup(group.key, { include: event.target.checked })}
                  />
                  <Input
                    aria-label="Předmět"
                    className="w-40"
                    value={group.subject}
                    onChange={(event) => updateGroup(group.key, { subject: event.target.value })}
                  />
                  <Input
                    aria-label="Ročník"
                    className="w-32"
                    placeholder="bez ročníku"
                    value={group.grade ?? ''}
                    onChange={(event) =>
                      updateGroup(group.key, { grade: event.target.value.trim() || null })
                    }
                  />
                  <Input
                    aria-label="Téma"
                    className="flex-1 min-w-48"
                    value={group.topic}
                    onChange={(event) => updateGroup(group.key, { topic: event.target.value })}
                  />
                </div>
                <ul className="mt-2 space-y-1 pl-8 text-sm text-ink-500">
                  {group.materials.map((material) => (
                    <li key={material.contentHash} className="flex flex-wrap items-center gap-2">
                      <span>{material.relativePath}</span>
                      <span className="ml-auto">{material.text.length.toLocaleString('cs')} znaků</span>
                      {material.needsOcr ? <Badge tone="warn">skoro bez textu</Badge> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
```

6. Odstraň nepoužitý import `ExtractedMaterial`, pokud po úpravě v souboru nezbyl.

- [ ] **Step 6: Ověř naživo**

Run: `pnpm dev`, otevři `/import` a vyber složku se dvěma tématy.
Expected: objeví se skupiny s editovatelnými poli, odškrtnutá skupina se nenaimportuje, přepsané téma se uloží pod novým názvem.

- [ ] **Step 7: Ověř a commitni**

Run: `pnpm test && pnpm typecheck && pnpm build`

```bash
git add apps/web/test/importPreview.test.ts apps/web/src/lib/importPreview.ts apps/web/src/app/import/ImportClient.tsx
git commit -m "feat: review and fix the detected library structure before importing"
```

---

### Task 6: Obrazovka rychlého schvalování

Pokrývá B2. Jedna otázka přes obrazovku, klávesy, fronta napříč knihovnou.

**Files:**
- Create: `apps/web/test/reviewQueue.test.ts`
- Create: `apps/web/src/lib/reviewQueue.ts`
- Create: `apps/web/src/app/review/page.tsx`
- Create: `apps/web/src/app/review/ReviewClient.tsx`
- Modify: `apps/web/src/app/layout.tsx` (odkaz v navigaci)

**Interfaces:**
- Consumes:
  - `loadQuestions(filter)` a `toQuestion(row)` z `@/lib/questions`,
  - `PUT /api/questions` s tělem `{ ids: string[], status: 'draft' | 'approved' | 'rejected' }`,
  - `QuestionEditor` z `@/components/QuestionEditor` s props `{ topicId, question, onClose, onSaved }`.
- Produces:
  - `interface ReviewItem { question: Question; topicId: string; topicLabel: string }`
  - `buildReviewQueue(items: ReviewItem[], topicId?: string): ReviewItem[]`
  - `loadReviewQueue(): Promise<ReviewItem[]>` (serverová, v `@/lib/reviewQueue`)

- [ ] **Step 1: Napiš padající test fronty**

Vytvoř `apps/web/test/reviewQueue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Question } from '@testmaker/core/schema'
import { buildReviewQueue, type ReviewItem } from '@/lib/reviewQueue'

function item(id: string, status: Question['status'], topicId = 't1', createdAt = '2026-01-01'): ReviewItem {
  return {
    topicId,
    topicLabel: 'Přírodopis · 8. ročník · Buňka',
    question: {
      id,
      topicId,
      materialId: null,
      source: 'ai',
      status,
      createdAt,
      type: 'single_choice',
      payload: { prompt: `Otázka ${id}?`, options: ['a', 'b'], correctIndex: 0 },
      blocks: [],
      points: 1,
      difficulty: 2,
    } as Question,
  }
}

describe('fronta ke schválení', () => {
  it('nechá jen koncepty', () => {
    const queue = buildReviewQueue([item('a', 'draft'), item('b', 'approved'), item('c', 'rejected')])
    expect(queue.map((entry) => entry.question.id)).toEqual(['a'])
  })

  it('řadí od nejstarší, ať se fronta opravdu vyprazdňuje', () => {
    const queue = buildReviewQueue([
      item('novy', 'draft', 't1', '2026-03-01'),
      item('stary', 'draft', 't1', '2026-01-01'),
    ])
    expect(queue.map((entry) => entry.question.id)).toEqual(['stary', 'novy'])
  })

  it('umí frontu zúžit na jedno téma', () => {
    const queue = buildReviewQueue([item('a', 'draft', 't1'), item('b', 'draft', 't2')], 't2')
    expect(queue.map((entry) => entry.question.id)).toEqual(['b'])
  })

  it('bez konceptů vrátí prázdnou frontu', () => {
    expect(buildReviewQueue([item('a', 'approved')])).toEqual([])
  })
})
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `pnpm --filter @testmaker/web test`
Expected: FAIL — `Failed to resolve import "@/lib/reviewQueue"`.

- [ ] **Step 3: Napiš `apps/web/src/lib/reviewQueue.ts`**

```ts
import 'server-only'
import { asc, eq } from 'drizzle-orm'
import type { Question } from '@testmaker/core/schema'
import { db, grades, questions, subjects, topics } from '@/db'
import { toQuestion } from './questions'

export interface ReviewItem {
  question: Question
  topicId: string
  topicLabel: string
}

/** Koncepty od nejstarší, volitelně jen z jednoho tématu. */
export function buildReviewQueue(items: ReviewItem[], topicId?: string): ReviewItem[] {
  return items
    .filter((item) => item.question.status === 'draft')
    .filter((item) => !topicId || item.topicId === topicId)
    .sort((a, b) => a.question.createdAt.localeCompare(b.question.createdAt))
}

/** Všechny otázky knihovny s popiskem tématu; filtrování dělá `buildReviewQueue`. */
export async function loadReviewQueue(): Promise<ReviewItem[]> {
  const rows = await db
    .select({
      topicId: topics.id,
      topicName: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
      question: questions,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .orderBy(asc(questions.createdAt))

  return rows.map((row) => ({
    topicId: row.topicId,
    topicLabel: [row.subjectName, row.gradeName, row.topicName].filter(Boolean).join(' · '),
    question: toQuestion(row.question),
  }))
}
```

Pozor: `buildReviewQueue` je čistá a nesmí sahat do databáze — testuje se bez ní. `'server-only'` v souboru je kvůli `loadReviewQueue`; vitest importuje jen typy a čistou funkci, takže mu nevadí.

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `pnpm --filter @testmaker/web test`
Expected: PASS. Pokud vitest selže na `server-only`, přesuň `buildReviewQueue` a `ReviewItem` do `apps/web/src/lib/reviewQueue.pure.ts` bez `'server-only'`, reexportuj je z `reviewQueue.ts` a v testu importuj z `pure` souboru.

- [ ] **Step 5: Napiš serverovou stránku**

Vytvoř `apps/web/src/app/review/page.tsx`:

```tsx
import { EmptyState } from '@testmaker/ui'
import { buildReviewQueue, loadReviewQueue } from '@/lib/reviewQueue'
import { ReviewClient } from './ReviewClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Schvalování otázek – TestMaker' }

export default async function ReviewPage() {
  const queue = buildReviewQueue(await loadReviewQueue())

  if (queue.length === 0) {
    return (
      <EmptyState
        title="Žádné otázky ke schválení"
        hint="Všechno je projité. Nové koncepty přibudou, až vygeneruješ otázky k dalšímu tématu."
      />
    )
  }

  return <ReviewClient items={queue} />
}
```

- [ ] **Step 6: Napiš klientskou část s klávesami**

Vytvoř `apps/web/src/app/review/ReviewClient.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { QuestionStatus } from '@testmaker/core/schema'
import { Badge, Button, Card, QuestionPreview } from '@testmaker/ui'
import { QuestionEditor } from '@/components/QuestionEditor'
import type { ReviewItem } from '@/lib/reviewQueue'

export function ReviewClient({ items }: { items: ReviewItem[] }) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = items[index]

  const decide = useCallback(
    async (status: QuestionStatus) => {
      if (!current) return
      const response = await fetch('/api/questions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [current.question.id], status }),
      })
      if (!response.ok) {
        setError('Stav se nepodařilo uložit. Zkus to znovu.')
        return
      }
      setError(null)
      if (index + 1 >= items.length) router.refresh()
      else setIndex(index + 1)
    },
    [current, index, items.length, router],
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'a') void decide('approved')
      else if (key === 'z') void decide('rejected')
      else if (key === 'e') setEditing(true)
      else if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, items.length - 1))
      else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, editing, items.length])

  if (!current) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink-900">
          Schvalování otázek ({index + 1} / {items.length})
        </h1>
        <Badge tone="neutral">{current.topicLabel}</Badge>
      </div>

      <Card className="p-6">
        <QuestionPreview question={current.question} showAnswers />
      </Card>

      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void decide('approved')}>
          Schválit <kbd className="ml-1 text-xs opacity-70">A</kbd>
        </Button>
        <Button onClick={() => void decide('rejected')}>
          Zamítnout <kbd className="ml-1 text-xs opacity-70">Z</kbd>
        </Button>
        <Button onClick={() => setEditing(true)}>
          Upravit <kbd className="ml-1 text-xs opacity-70">E</kbd>
        </Button>
        <span className="self-center text-sm text-ink-500">Šipkami se posuneš bez rozhodnutí.</span>
      </div>

      {editing ? (
        <QuestionEditor
          topicId={current.topicId}
          question={current.question}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 7: Přidej odkaz do navigace**

V `apps/web/src/app/layout.tsx` přidej mezi stávající odkazy v hlavičce:

```tsx
<Link href="/review">Schvalování</Link>
```

Zachovej tvar a třídy ostatních odkazů v tom souboru.

- [ ] **Step 8: Ověř naživo**

Run: `pnpm dev`, otevři `/review`.
Expected: jedna otázka přes obrazovku; `A` ji schválí a posune na další, `Z` zamítne, `E` otevře editor, v editoru klávesy nic nespouštějí.

- [ ] **Step 9: Ověř a commitni**

Run: `pnpm test && pnpm typecheck && pnpm build`

```bash
git add apps/web/test/reviewQueue.test.ts apps/web/src/lib/reviewQueue.ts apps/web/src/app/review apps/web/src/app/layout.tsx
git commit -m "feat: add a keyboard-driven screen for approving questions"
```

---

### Task 7: Regenerace jedné otázky

Pokrývá B3. Špatnou otázku jde nahradit novou, aniž by ji učitelka psala ručně.

**Files:**
- Create: `apps/web/src/app/api/questions/regenerate/route.ts`
- Modify: `apps/web/src/lib/generation.ts` (nová funkce `regenerateQuestion`)
- Modify: `apps/web/src/app/review/ReviewClient.tsx` (tlačítko)
- Modify: `packages/core/test/ai.test.ts` (test vyhýbacího promptu)

**Interfaces:**
- Consumes:
  - `loadTopicSource(topicId)` z `@/lib/generation`,
  - `generateQuestions(request, options)` a `promptOf(question)` z `@testmaker/core/ai`,
  - `insertQuestions(items, context)` a `questionPrompt(question)` z `@/lib/questions`.
- Produces:
  - `regenerateQuestion(questionId: string): Promise<{ id: string }>` v `@/lib/generation`.

- [ ] **Step 1: Napiš padající test vyhýbacího promptu**

Do `packages/core/test/ai.test.ts` přidej do bloku `describe('prompty', …)`:

```ts
  it('vypíše do promptu zadání, kterým se má generování vyhnout', () => {
    const prompt = buildUserPrompt({
      text: 'Srdce pohání krev v oběhu.',
      topicName: 'Oběhová soustava',
      subjectName: 'Přírodopis',
      gradeName: '8. ročník',
      count: 1,
      types: ['single_choice'],
      difficulty: 2,
      avoid: ['Kolik má srdce oddílů?', 'Co je aorta?'],
    })
    expect(prompt).toContain('Kolik má srdce oddílů?')
    expect(prompt).toContain('Co je aorta?')
  })
```

- [ ] **Step 2: Spusť test**

Run: `pnpm --filter @testmaker/core test`
Expected: PASS, pokud `buildUserPrompt` vyhýbací zadání už vypisuje. Pokud FAIL, doplň je v `packages/core/src/ai/prompt.ts` do `sections` jako sekci
`Vyhni se těmto zadáním, už existují:` následovanou odrážkami z `request.avoid`, a test spusť znovu.

- [ ] **Step 3: Napiš `regenerateQuestion`**

Na konec `apps/web/src/lib/generation.ts` doplň:

```ts
/**
 * Nahradí jednu špatnou otázku novou. Původní se zamítne a do promptu jde
 * jako zadání, kterému se má model vyhnout — jinak často vrátí totéž znovu.
 */
export async function regenerateQuestion(questionId: string): Promise<{ id: string }> {
  const [row] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1)
  if (!row) throw new Error('Otázka nenalezena')
  if (!row.topicId) throw new Error('Otázka nepatří k žádnému tématu, nejde ji vygenerovat znovu')

  const source = await loadTopicSource(row.topicId)
  if (!source) throw new Error('Téma nenalezeno')

  const siblings = await db.select().from(questions).where(eq(questions.topicId, row.topicId)).limit(80)

  const result = await generateQuestions({
    text: source.text,
    topicName: source.topicName,
    subjectName: source.subjectName,
    gradeName: source.gradeName,
    count: 1,
    types: [row.type],
    difficulty: (row.difficulty as 1 | 2 | 3) ?? 2,
    avoid: siblings.map((sibling) => questionPrompt(toQuestion(sibling))),
  })

  const [replacement] = result.questions
  if (!replacement) throw new Error('Model nevrátil použitelnou náhradu, zkus to znovu')

  const [id] = await insertQuestions([replacement], {
    topicId: row.topicId,
    materialId: row.materialId,
    source: 'ai',
    status: 'draft',
  })
  await db.update(questions).set({ status: 'rejected' }).where(eq(questions.id, questionId))

  return { id }
}
```

Doplň chybějící importy v hlavičce souboru: `toQuestion` z `./questions` (vedle už importovaných `insertQuestions` a `questionPrompt`).

- [ ] **Step 4: Napiš API**

Vytvoř `apps/web/src/app/api/questions/regenerate/route.ts`:

```ts
import { z } from 'zod'
import { isAiConfigured } from '@testmaker/core/ai'
import { regenerateQuestion } from '@/lib/generation'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({ id: z.string().min(1) })

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return Response.json({ error: 'Generování není nastavené — chybí API klíč.' }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Chybí id otázky' }, { status: 400 })

  try {
    return Response.json(await regenerateQuestion(parsed.data.id))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 5: Přidej tlačítko do schvalování**

V `apps/web/src/app/review/ReviewClient.tsx` doplň stav a funkci vedle `decide`:

```tsx
  const [regenerating, setRegenerating] = useState(false)

  async function regenerate() {
    if (!current) return
    setRegenerating(true)
    setError(null)
    const response = await fetch('/api/questions/regenerate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: current.question.id }),
    })
    setRegenerating(false)
    if (!response.ok) {
      const detail = (await response.json()) as { error?: string }
      setError(detail.error ?? 'Náhradu se nepodařilo vygenerovat.')
      return
    }
    router.refresh()
  }
```

A do řádku s tlačítky před text o šipkách:

```tsx
        <Button disabled={regenerating} onClick={() => void regenerate()}>
          {regenerating ? 'Generuji náhradu…' : 'Dej jinou'}
        </Button>
```

- [ ] **Step 6: Ověř naživo**

Run: `pnpm dev` s vyplněným `ANTHROPIC_API_KEY`, otevři `/review` a klikni „Dej jinou“.
Expected: původní otázka zmizí z fronty (je zamítnutá) a ve stejném tématu přibude nová otázka téhož typu v konceptu. Bez klíče se vrátí česká hláška o chybějícím nastavení.

- [ ] **Step 7: Ověř a commitni**

Run: `pnpm test && pnpm typecheck && pnpm build`

```bash
git add apps/web/src/app/api/questions/regenerate apps/web/src/lib/generation.ts apps/web/src/app/review/ReviewClient.tsx packages/core/test/ai.test.ts
git commit -m "feat: replace a bad question with a freshly generated one"
```

---

### Task 8: Aktualizace dokumentace

Uzavírá plán: README a ROADMAP musí popisovat, co aplikace po těchhle změnách umí.

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: hotové úkoly 1–7.
- Produces: nic, na čem by kód stál.

- [ ] **Step 1: Doplň README**

Do sekce „Co umí“ přidej odrážky:

- **Náhled importu.** Odhadnutá struktura Předmět → Ročník → Téma se ukáže před uložením a jde ji přepsat nebo z importu vynechat.
- **Schvalování na jednu klávesu.** Stránka Schvalování projde všechny koncepty napříč knihovnou; `A` schválí, `Z` zamítne, `E` otevře editor. Do testu se nabízejí jen schválené otázky.
- **Náhrada otázky.** Špatnou otázku nahradí nová vygenerovaná; ta původní jde do zamítnutých a modelu se pošle jako to, čemu se má vyhnout.
- **Záloha knihovny.** Celá banka se stáhne jako jeden JSON a stejným souborem se dá nahrát zpět.

Do sekce Rychlý start doplň, že `APP_PASSWORD` a `AUTH_SECRET` zapínají přihlášení a prázdné `APP_PASSWORD` znamená běh bez něj.

- [ ] **Step 2: Uprav ROADMAP**

Z „Blízké kroky“ a „Provoz a přístup“ odstraň položku **Generování na pozadí** (hotovo Taskem 2). K položce **Přihlášení a více učitelů** doplň poznámku, že jedno sdílené heslo už funguje a zbývá dělení na víc učitelů. Do „Práce s testy“ nech **Export a import banky otázek** s poznámkou, že záloha celé knihovny existuje a chybí jen výběrový export.

- [ ] **Step 3: Zapiš do CHANGELOGu**

Do `CHANGELOG.md` přidej nahoru sekci s dnešním datem a odrážkami: přihlášení heslem, fronta z plánovače, záloha knihovny, náhled importu, obrazovka schvalování, náhrada otázky, výběr do testu jen ze schválených. Drž formát, který soubor už používá.

- [ ] **Step 4: Ověř a commitni**

Run: `pnpm build`

```bash
git add README.md ROADMAP.md CHANGELOG.md
git commit -m "docs: describe login, scheduler, backup, import preview and review"
```
