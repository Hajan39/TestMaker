import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { t } from '@testmaker/core/i18n'
import type { RegenerateReason } from '@testmaker/core/schema'
import { db, promptRules } from '@/db'
import { newId } from './ids'
import { inSchool, type Scope } from './user'

/** A longer rule would bloat the prompt, and teachers do not write essays into the text field. */
export const MAX_PROMPT_RULE_LENGTH = 300

/**
 * At most ten active rules — the prompt must stay short so the model keeps
 * all of it (`ai.test.ts`: the system prompt is short). A school that wants
 * more rules must first disable some.
 */
export const MAX_ACTIVE_PROMPT_RULES = 10

export interface PromptRule {
  id: string
  text: string
  reason: RegenerateReason | null
  active: boolean
  createdAt: string
}

/** An eleventh active rule — the manager must first disable one. */
export class TooManyRules extends Error {
  constructor() {
    super(t('admin:errors.tooManyRules', { max: MAX_ACTIVE_PROMPT_RULES }))
    this.name = 'TooManyRules'
  }
}

function toRuleRow(row: {
  id: string
  text: string
  reason: RegenerateReason | null
  active: boolean
  createdAt: string
}): PromptRule {
  return { id: row.id, text: row.text, reason: row.reason, active: row.active, createdAt: row.createdAt }
}

/**
 * The school's active rules — text only, in creation order, for appending to
 * the system prompt (`buildSystemPrompt`). A disabled rule never gets here,
 * nor does another school's rule — `inSchool()` is the only condition.
 */
export async function loadActivePromptRules(scope: Scope): Promise<string[]> {
  const rows = await db
    .select({ text: promptRules.text })
    .from(promptRules)
    .where(and(inSchool(scope, promptRules), eq(promptRules.active, true)))
    .orderBy(asc(promptRules.createdAt))
  return rows.map((row) => row.text)
}

/** All of the school's rules for Management — newest first. */
export async function loadPromptRules(scope: Scope): Promise<PromptRule[]> {
  const rows = await db
    .select({
      id: promptRules.id,
      text: promptRules.text,
      reason: promptRules.reason,
      active: promptRules.active,
      createdAt: promptRules.createdAt,
    })
    .from(promptRules)
    .where(inSchool(scope, promptRules))
    .orderBy(desc(promptRules.createdAt))
  return rows.map(toRuleRow)
}

async function countActive(scope: Scope): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(promptRules)
    .where(and(inSchool(scope, promptRules), eq(promptRules.active, true)))
  return Number(row?.value ?? 0)
}

/**
 * Creates a rule — always active and only on the manager's explicit save
 * (never on its own). The text is truncated to `MAX_PROMPT_RULE_LENGTH`, not
 * rejected: the manager edits it in the form, truncation is the last
 * safeguard, not the first reaction.
 */
export async function createPromptRule(
  scope: Scope,
  input: { text: string; reason?: RegenerateReason | null },
): Promise<PromptRule> {
  // Collapsed to single spaces — the rule is a bullet in the system prompt
  // (`- ${rule}`) and in the header of the downloaded file for `/otazky`; extra spaces
  // or line breaks from the Textarea would split both into several lines.
  const text = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_RULE_LENGTH)
  if (!text) throw new Error(t('admin:errors.ruleEmpty'))
  if ((await countActive(scope)) >= MAX_ACTIVE_PROMPT_RULES) throw new TooManyRules()

  const id = newId()
  await db.insert(promptRules).values({
    id,
    schoolId: scope.schoolId,
    text,
    reason: input.reason ?? null,
    active: true,
    createdBy: scope.userId,
  })
  const [row] = await db.select().from(promptRules).where(eq(promptRules.id, id)).limit(1)
  return toRuleRow(row!)
}

/**
 * Enables or disables a rule. A foreign rule pretends not to exist —
 * `false`, not an exception, so the calling route can send 404 just like
 * any other scoped read.
 */
export async function setPromptRuleActive(scope: Scope, id: string, active: boolean): Promise<boolean> {
  const [existing] = await db
    .select({ active: promptRules.active })
    .from(promptRules)
    .where(and(inSchool(scope, promptRules), eq(promptRules.id, id)))
    .limit(1)
  if (!existing) return false

  // The limit is checked only on an actual enable — otherwise a rule that
  // is already active could not be saved as active again at the limit of ten.
  if (active && !existing.active && (await countActive(scope)) >= MAX_ACTIVE_PROMPT_RULES) {
    throw new TooManyRules()
  }

  const result = await db
    .update(promptRules)
    .set({ active })
    .where(and(inSchool(scope, promptRules), eq(promptRules.id, id)))
    .returning({ id: promptRules.id })
  return result.length > 0
}
