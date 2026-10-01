import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, promptRules, schools, users } from '@/db'
import {
  MAX_ACTIVE_PROMPT_RULES,
  TooManyRules,
  createPromptRule,
  loadActivePromptRules,
  loadPromptRules,
  setPromptRuleActive,
} from '@/lib/promptRules'
import { newId } from '@/lib/ids'
import type { Scope } from '@/lib/user'
import { ACCOUNT } from './helpers'

/**
 * School prompt rules: active ones reach generation, disabled ones do not,
 * another school's never — and at most ten may be active (review point 5, task 4).
 */

const FOREIGN_SCHOOL = 'skola-jina-pravidla'

/** An account of a truly different school — to test that rules do not mix between schools. */
async function foreignScope(): Promise<Scope> {
  await db.insert(schools).values({ id: FOREIGN_SCHOOL, name: 'Jiná škola', slug: 'jina-pravidla' }).onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({ id, schoolId: FOREIGN_SCHOOL, email: `${id}@jina.cz`, name: 'Cizí správce', role: 'spravce' })
  return { schoolId: FOREIGN_SCHOOL, userId: id, role: 'spravce' }
}

beforeEach(async () => {
  await db.delete(promptRules)
})

describe('createPromptRule', () => {
  it('creates an active rule with trimmed text', async () => {
    const longText = 'x'.repeat(400)
    const rule = await createPromptRule(ACCOUNT, { text: longText })
    expect(rule.active).toBe(true)
    expect(rule.text).toHaveLength(300)
  })

  it('rejects empty text (also after trimming spaces)', async () => {
    await expect(createPromptRule(ACCOUNT, { text: '   ' })).rejects.toThrow(/prázdné/)
  })

  it('collapses inner spaces and line breaks into a single space', async () => {
    // The Textarea in Management allows several lines; as a bullet in the system
    // prompt (`- ${rule}`) and in the header of the downloaded file for `/otazky` the
    // rule must stay on one line, otherwise it would break the bullets.
    const rule = await createPromptRule(ACCOUNT, { text: '  Piš   krátce\n\na  jasně.  ' })
    expect(rule.text).toBe('Piš krátce a jasně.')
  })

  it('rejects an eleventh active rule with a Czech message', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(ACCOUNT, { text: `Pravidlo ${i}` })
    }
    await expect(createPromptRule(ACCOUNT, { text: 'Jedenácté' })).rejects.toThrow(TooManyRules)
    await expect(createPromptRule(ACCOUNT, { text: 'Jedenácté' })).rejects.toThrow(/nejvýš 10/)
  })
})

describe('setPromptRuleActive', () => {
  it('a disabled rule disappears from the active ones, an enabled one comes back', async () => {
    const rule = await createPromptRule(ACCOUNT, { text: 'Piš krátce.' })
    expect(await loadActivePromptRules(ACCOUNT)).toEqual(['Piš krátce.'])

    await setPromptRuleActive(ACCOUNT, rule.id, false)
    expect(await loadActivePromptRules(ACCOUNT)).toEqual([])

    await setPromptRuleActive(ACCOUNT, rule.id, true)
    expect(await loadActivePromptRules(ACCOUNT)).toEqual(['Piš krátce.'])
  })

  it('a foreign rule pretends not to exist', async () => {
    const rule = await createPromptRule(ACCOUNT, { text: 'Moje pravidlo' })
    const foreign = { ...ACCOUNT, schoolId: FOREIGN_SCHOOL }
    expect(await setPromptRuleActive(foreign, rule.id, false)).toBe(false)

    const [row] = await db.select().from(promptRules).where(eq(promptRules.id, rule.id))
    expect(row?.active).toBe(true)
  })

  it('re-saving an already active rule as active at the limit of ten does not fail', async () => {
    const first = await createPromptRule(ACCOUNT, { text: 'První' })
    for (let i = 1; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(ACCOUNT, { text: `Pravidlo ${i}` })
    }
    // Ten are active already — saving the first one as active again must not fail.
    await expect(setPromptRuleActive(ACCOUNT, first.id, true)).resolves.toBe(true)
  })

  it('enabling an eleventh is rejected just like creating one', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(ACCOUNT, { text: `Pravidlo ${i}` })
    }
    // The disabled rule was created before ten active ones filled up —
    // `createPromptRule` would not create an eleventh active one at all.
    const id = 'vypnute-jedenacte'
    await db.insert(promptRules).values({
      id,
      schoolId: ACCOUNT.schoolId,
      text: 'Vypnuté',
      active: false,
      createdBy: ACCOUNT.userId,
    })
    await expect(setPromptRuleActive(ACCOUNT, id, true)).rejects.toThrow(TooManyRules)
  })
})

describe('loadActivePromptRules a loadPromptRules', () => {
  it('never another school — neither in the Management list nor in the active ones for the prompt', async () => {
    const foreign = await foreignScope()
    await createPromptRule(foreign, { text: 'Cizí pravidlo' })

    expect(await loadActivePromptRules(ACCOUNT)).toEqual([])
    expect(await loadPromptRules(ACCOUNT)).toEqual([])
  })

  it('the Management list shows both active and disabled rules', async () => {
    const active = await createPromptRule(ACCOUNT, { text: 'Aktivní' })
    const disabled = await createPromptRule(ACCOUNT, { text: 'Vypnuté' })
    await setPromptRuleActive(ACCOUNT, disabled.id, false)

    const list = await loadPromptRules(ACCOUNT)
    expect(list.find((p) => p.id === active.id)?.active).toBe(true)
    expect(list.find((p) => p.id === disabled.id)?.active).toBe(false)
  })
})
