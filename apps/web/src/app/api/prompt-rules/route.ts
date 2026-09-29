import { z } from 'zod'
import { REGENERATE_REASONS, type RegenerateReason } from '@testmaker/core/schema'
import {
  MAX_PROMPT_RULE_LENGTH,
  PrilisMnohoPravidel,
  createPromptRule,
  loadPromptRules,
  setPromptRuleActive,
} from '@/lib/promptRules'
import { ROLE_SPRAVY } from '@/lib/role'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

const reasonKeys = Object.keys(REGENERATE_REASONS) as [RegenerateReason, ...RegenerateReason[]]
const reasonSchema = z.enum(reasonKeys)

const createSchema = z.object({
  text: z.string().trim().min(1).max(MAX_PROMPT_RULE_LENGTH),
  reason: reasonSchema.nullish(),
})

const updateSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
})

/** Seznam pravidel promptu školy — jen správce. */
export async function GET() {
  return sRozsahem(
    async (ucet) => {
      const pravidla = await loadPromptRules(ucet)
      return Response.json({ pravidla })
    },
    { role: ROLE_SPRAVY },
  )
}

/**
 * Založí pravidlo. Nejčastěji z tlačítka „Udělat z toho pravidlo" u důvodu
 * přegenerování v záložce AI kvalita — text je předvyplněný z nápovědy
 * (`REGENERATE_REASONS[reason].hint`), ale správce ho může upravit, i vypustit
 * `reason` a napsat pravidlo úplně vlastní.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
      try {
        const pravidlo = await createPromptRule(ucet, { text: parsed.data.text, reason: parsed.data.reason })
        return Response.json({ pravidlo })
      } catch (error) {
        if (error instanceof PrilisMnohoPravidel) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { role: ROLE_SPRAVY },
  )
}

/** Zapne, nebo vypne pravidlo. Cizí, nebo neexistující id → 404. */
export async function PATCH(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const parsed = updateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Neplatná data' }, { status: 400 })
      try {
        const ok = await setPromptRuleActive(ucet, parsed.data.id, parsed.data.active)
        if (!ok) return Response.json({ error: 'Pravidlo se nenašlo' }, { status: 404 })
        return Response.json({ ok: true })
      } catch (error) {
        if (error instanceof PrilisMnohoPravidel) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { role: ROLE_SPRAVY },
  )
}
