import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { RegenerateReason } from '@testmaker/core/schema'
import { db, promptRules } from '@/db'
import { newId } from './ids'
import { skola, type Scope } from './uzivatel'

/** Delší pravidlo by prompt nafouklo a učitelky do textového pole nepíšou eseje. */
export const MAX_PROMPT_RULE_LENGTH = 300

/**
 * Aktivních pravidel nejvýš deset — prompt musí zůstat krátký, aby ho model
 * udržel celý (`ai.test.ts`: „systémový prompt je krátký"). Škola, která by
 * chtěla pravidel víc, si musí nějaké nejdřív vypnout.
 */
export const MAX_ACTIVE_PROMPT_RULES = 10

export interface PromptRule {
  id: string
  text: string
  reason: RegenerateReason | null
  active: boolean
  createdAt: string
}

/** Jedenácté aktivní pravidlo — správce musí nejdřív nějaké vypnout. */
export class PrilisMnohoPravidel extends Error {
  constructor() {
    super(`Aktivních pravidel může být nejvýš ${MAX_ACTIVE_PROMPT_RULES}. Nejdřív nějaké vypni.`)
    this.name = 'PrilisMnohoPravidel'
  }
}

function radek(row: {
  id: string
  text: string
  reason: RegenerateReason | null
  active: boolean
  createdAt: string
}): PromptRule {
  return { id: row.id, text: row.text, reason: row.reason, active: row.active, createdAt: row.createdAt }
}

/**
 * Aktivní pravidla školy — jen text, v pořadí vzniku, pro připojení do
 * systémového promptu (`buildSystemPrompt`). Vypnuté pravidlo se sem nikdy
 * nedostane a pravidlo jiné školy taky ne — `skola()` je jediná podmínka.
 */
export async function loadActivePromptRules(scope: Scope): Promise<string[]> {
  const rows = await db
    .select({ text: promptRules.text })
    .from(promptRules)
    .where(and(skola(scope, promptRules), eq(promptRules.active, true)))
    .orderBy(asc(promptRules.createdAt))
  return rows.map((row) => row.text)
}

/** Všechna pravidla školy pro Správu — nejnovější první. */
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
    .where(skola(scope, promptRules))
    .orderBy(desc(promptRules.createdAt))
  return rows.map(radek)
}

async function countActive(scope: Scope): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(promptRules)
    .where(and(skola(scope, promptRules), eq(promptRules.active, true)))
  return Number(row?.value ?? 0)
}

/**
 * Založí pravidlo — vždy aktivní a vždy jen na výslovné uložení správce
 * (nikdy samo od sebe). Text se ořízne na `MAX_PROMPT_RULE_LENGTH`, ne
 * odmítne: správce si ho ve formuláři upravuje sám, oříznutí je poslední
 * pojistka, ne první reakce.
 */
export async function createPromptRule(
  scope: Scope,
  input: { text: string; reason?: RegenerateReason | null },
): Promise<PromptRule> {
  // Sjednocené na jednu mezeru — pravidlo je odrážka v systémovém promptu
  // (`- ${rule}`) i v hlavičce staženého souboru pro `/otazky`; víc mezer
  // nebo odřádkování z Textarey by tam obojí rozbilo na víc řádků.
  const text = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_RULE_LENGTH)
  if (!text) throw new Error('Pravidlo nemůže být prázdné.')
  if ((await countActive(scope)) >= MAX_ACTIVE_PROMPT_RULES) throw new PrilisMnohoPravidel()

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
  return radek(row!)
}

/**
 * Zapne, nebo vypne pravidlo. Cizí pravidlo se tváří jako neexistující —
 * `false`, ne výjimka, aby volající route mohla poslat 404 stejně jako
 * u všeho ostatního rozsahového čtení.
 */
export async function setPromptRuleActive(scope: Scope, id: string, active: boolean): Promise<boolean> {
  const [existing] = await db
    .select({ active: promptRules.active })
    .from(promptRules)
    .where(and(skola(scope, promptRules), eq(promptRules.id, id)))
    .limit(1)
  if (!existing) return false

  // Limit se kontroluje jen při skutečném zapnutí — jinak by se pravidlo,
  // které je aktivní už teď, nedalo znovu uložit jako aktivní na hranici deseti.
  if (active && !existing.active && (await countActive(scope)) >= MAX_ACTIVE_PROMPT_RULES) {
    throw new PrilisMnohoPravidel()
  }

  const result = await db
    .update(promptRules)
    .set({ active })
    .where(and(skola(scope, promptRules), eq(promptRules.id, id)))
    .returning({ id: promptRules.id })
  return result.length > 0
}
