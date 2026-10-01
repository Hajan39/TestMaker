import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, promptRules } from '@/db'
import { GET as list, PATCH as update, POST as create } from '@/app/api/prompt-rules/route'
import { MAX_ACTIVE_PROMPT_RULES, createPromptRule } from '@/lib/promptRules'
import { jsonReq, seedAccount, ACCOUNT } from './helpers'

/**
 * School prompt rules API — manager only (403 for a teacher), at most ten
 * active (400 with a Czech message on the eleventh).
 */

beforeEach(async () => {
  await db.delete(promptRules)
  vi.unstubAllEnvs()
})

describe('GET/POST/PATCH /api/prompt-rules', () => {
  it('creates a rule with a reason and sees it in the list right away', async () => {
    const response = await create(
      jsonReq('/api/prompt-rules', 'POST', { text: 'Piš kratší zadání.', reason: 'tezka' }),
    )
    expect(response.status).toBe(200)

    const listResponse = await list()
    const { rules } = (await listResponse.json()) as { rules: { text: string; reason: string | null }[] }
    expect(rules.some((p) => p.text === 'Piš kratší zadání.' && p.reason === 'tezka')).toBe(true)
  })

  it('disabling a rule shows in the list', async () => {
    const rule = await createPromptRule(ACCOUNT, { text: 'Nějaké pravidlo' })
    const response = await update(jsonReq('/api/prompt-rules', 'PATCH', { id: rule.id, active: false }))
    expect(response.status).toBe(200)

    const listResponse = await list()
    const { rules } = (await listResponse.json()) as { rules: { id: string; active: boolean }[] }
    expect(rules.find((p) => p.id === rule.id)?.active).toBe(false)
  })

  it('an eleventh active rule is 400 with a Czech message', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      const r = await create(jsonReq('/api/prompt-rules', 'POST', { text: `Pravidlo ${i}` }))
      expect(r.status).toBe(200)
    }
    const response = await create(jsonReq('/api/prompt-rules', 'POST', { text: 'Jedenácté' }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('nejvýš 10') })
  })

  it('an invalid reason is 400', async () => {
    const response = await create(
      jsonReq('/api/prompt-rules', 'POST', { text: 'Text', reason: 'neexistujici-duvod' }),
    )
    expect(response.status).toBe(400)
  })

  it('a nonexistent id when disabling is 404', async () => {
    const response = await update(jsonReq('/api/prompt-rules', 'PATCH', { id: 'neexistuje', active: false }))
    expect(response.status).toBe(404)
  })

  it('a teacher may not touch prompt rules — 403', async () => {
    vi.stubEnv('E2E_UZIVATEL', (await seedAccount({ role: 'ucitelka' })).userId)
    const response = await create(jsonReq('/api/prompt-rules', 'POST', { text: 'Text' }))
    expect(response.status).toBe(403)
  })
})
