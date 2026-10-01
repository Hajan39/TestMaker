import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `proxy.ts` runs in the Edge runtime, which has neither `node:crypto` nor the
 * database. A single extra import in `lib/session.ts` breaks the build of the
 * whole app — which is only discovered at deployment. Hence this guard test.
 */
function source(filePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', filePath), 'utf8')
}

describe('what the gate may see', () => {
  it('session.ts touches neither the database nor node:crypto', () => {
    // Imports are checked, not text: comments name `node:crypto` precisely to
    // show what must not get in here.
    const imports = [...source('src/lib/session.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(imports).not.toContain('node:crypto')
    expect(imports).not.toContain('@/db')
    expect(imports).not.toContain('server-only')
    expect(imports.every((filePath) => filePath?.startsWith('./'))).toBe(true)
  })

  it('proxy.ts takes only session.ts, nothing from the server side', () => {
    const text = source('src/proxy.ts')
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    // Translations are plain JS + JSON (no DB, no node:crypto), safe in Edge.
    expect(imports.sort()).toEqual(['@/lib/session', '@testmaker/core/i18n', 'next/server'])
  })

  it('roles live in a dependency-free module so both the schema and the gate can read them', () => {
    const text = source('src/lib/role.ts')
    expect(text).not.toContain('import ')
  })
})
