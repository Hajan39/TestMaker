import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `proxy.ts` běží v Edge runtime, kde `node:crypto` ani databáze nejsou.
 * Stačí jediný import navíc v `lib/session.ts` a shodí se build celé
 * aplikace — na což se přijde až při nasazení. Proto tenhle strážný test.
 */
function zdroj(cesta: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', cesta), 'utf8')
}

describe('co smí vidět brána', () => {
  it('session.ts nesahá na databázi ani na node:crypto', () => {
    // Hlídají se importy, ne text: v komentářích se `node:crypto` jmenuje
    // právě proto, aby bylo vidět, co se sem nesmí dostat.
    const importy = [...zdroj('src/lib/session.ts').matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(importy).not.toContain('node:crypto')
    expect(importy).not.toContain('@/db')
    expect(importy).not.toContain('server-only')
    expect(importy.every((cesta) => cesta?.startsWith('./'))).toBe(true)
  })

  it('proxy.ts si bere jen session.ts, nic ze serverové části', () => {
    const text = zdroj('src/proxy.ts')
    const importy = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(importy.sort()).toEqual(['@/lib/session', 'next/server'])
  })

  it('role jsou v modulu bez závislostí, aby je četlo schéma i brána', () => {
    const text = zdroj('src/lib/role.ts')
    expect(text).not.toContain('import ')
  })
})
