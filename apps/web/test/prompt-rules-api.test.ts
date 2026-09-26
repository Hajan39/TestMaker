import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, promptRules } from '@/db'
import { GET as seznam, PATCH as upravit, POST as zalozit } from '@/app/api/prompt-rules/route'
import { MAX_ACTIVE_PROMPT_RULES, createPromptRule } from '@/lib/promptRules'
import { jsonReq, seedUcet, UCET } from './helpers'

/**
 * API pravidel promptu školy — jen správce (403 pro učitelku), max deset
 * aktivních (400 s českou hláškou při jedenáctém).
 */

beforeEach(async () => {
  await db.delete(promptRules)
  vi.unstubAllEnvs()
})

describe('GET/POST/PATCH /api/prompt-rules', () => {
  it('založí pravidlo s důvodem a hned ho vidí v seznamu', async () => {
    const response = await zalozit(
      jsonReq('/api/prompt-rules', 'POST', { text: 'Piš kratší zadání.', reason: 'tezka' }),
    )
    expect(response.status).toBe(200)

    const seznamResponse = await seznam()
    const { pravidla } = (await seznamResponse.json()) as { pravidla: { text: string; reason: string | null }[] }
    expect(pravidla.some((p) => p.text === 'Piš kratší zadání.' && p.reason === 'tezka')).toBe(true)
  })

  it('vypnutí pravidla se projeví v seznamu', async () => {
    const pravidlo = await createPromptRule(UCET, { text: 'Nějaké pravidlo' })
    const response = await upravit(jsonReq('/api/prompt-rules', 'PATCH', { id: pravidlo.id, active: false }))
    expect(response.status).toBe(200)

    const seznamResponse = await seznam()
    const { pravidla } = (await seznamResponse.json()) as { pravidla: { id: string; active: boolean }[] }
    expect(pravidla.find((p) => p.id === pravidlo.id)?.active).toBe(false)
  })

  it('jedenácté aktivní pravidlo je 400 s českou hláškou', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      const r = await zalozit(jsonReq('/api/prompt-rules', 'POST', { text: `Pravidlo ${i}` }))
      expect(r.status).toBe(200)
    }
    const response = await zalozit(jsonReq('/api/prompt-rules', 'POST', { text: 'Jedenácté' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('nejvýš 10') })
  })

  it('neplatný důvod je 400', async () => {
    const response = await zalozit(
      jsonReq('/api/prompt-rules', 'POST', { text: 'Text', reason: 'neexistujici-duvod' }),
    )
    expect(response.status).toBe(400)
  })

  it('neexistující id při vypnutí je 404', async () => {
    const response = await upravit(jsonReq('/api/prompt-rules', 'PATCH', { id: 'neexistuje', active: false }))
    expect(response.status).toBe(404)
  })

  it('učitelka do pravidel promptu nesmí — 403', async () => {
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'ucitelka' })).userId)
    const response = await zalozit(jsonReq('/api/prompt-rules', 'POST', { text: 'Text' }))
    expect(response.status).toBe(403)
  })
})
