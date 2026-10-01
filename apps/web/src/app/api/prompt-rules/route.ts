import { t } from '@testmaker/core/i18n'
import { z } from 'zod'
import { REGENERATE_REASONS, type RegenerateReason } from '@testmaker/core/schema'
import {
  MAX_PROMPT_RULE_LENGTH,
  TooManyRules,
  createPromptRule,
  loadPromptRules,
  setPromptRuleActive,
} from '@/lib/promptRules'
import { MANAGEMENT_ROLES } from '@/lib/role'
import { withScope } from '@/lib/user'

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

/** List of the school's prompt rules — manager only. */
export async function GET() {
  return withScope(
    async (account) => {
      const rules = await loadPromptRules(account)
      return Response.json({ rules })
    },
    { role: MANAGEMENT_ROLES },
  )
}

/**
 * Creates a rule. Usually from the "Make it a rule" button next to a
 * regeneration reason in the AI quality tab — the text is prefilled from the hint
 * (`REGENERATE_REASONS[reason].hint`), but the manager may edit it, or drop
 * `reason` and write an entirely custom rule.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })
      try {
        const rule = await createPromptRule(account, { text: parsed.data.text, reason: parsed.data.reason })
        return Response.json({ rule })
      } catch (error) {
        if (error instanceof TooManyRules) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { role: MANAGEMENT_ROLES },
  )
}

/** Enables or disables a rule. A foreign or nonexistent id → 404. */
export async function PATCH(request: Request) {
  return withScope(
    async (account) => {
      const parsed = updateSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: t('admin:errors.invalidData') }, { status: 400 })
      try {
        const ok = await setPromptRuleActive(account, parsed.data.id, parsed.data.active)
        if (!ok) return Response.json({ error: t('admin:errors.ruleNotFound') }, { status: 404 })
        return Response.json({ ok: true })
      } catch (error) {
        if (error instanceof TooManyRules) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        throw error
      }
    },
    { role: MANAGEMENT_ROLES },
  )
}
