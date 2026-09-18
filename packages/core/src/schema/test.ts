import { z } from 'zod'
import { questionContentSchema, type Question, type QuestionContent } from './question'
import { parsePuzzleSnapshot, toPuzzleSnapshot, type Puzzle, type PuzzleContent } from './puzzle'
import type { Template } from './template'

/**
 * Položka testu — struktura testu není omezená na pouhý seznam otázek.
 * Pátý druh, `puzzle`, je hotový hlavolam (osmisměrka, tajenka): není to
 * otázka a v bance nemá co dělat, ale do písemky se zařadit má.
 */
export const TEST_ITEM_KINDS = ['question', 'heading', 'instruction', 'page_break', 'puzzle'] as const
export type TestItemKind = (typeof TEST_ITEM_KINDS)[number]

export const testHeaderConfigSchema = z.object({
  school: z.string().default(''),
  subject: z.string().default(''),
  className: z.string().default(''),
  teacher: z.string().default(''),
  /** Datum jako text; prázdné = linka k doplnění. */
  date: z.string().default(''),
  note: z.string().default(''),
})

export type TestHeaderConfig = z.infer<typeof testHeaderConfigSchema>

export interface TestItem {
  id: string
  testId: string
  order: number
  kind: TestItemKind
  /** Vyplněno u `kind === 'question'`. */
  questionId: string | null
  /** Vyplněno u `kind === 'puzzle'`. */
  puzzleId?: string | null
  /** Text nadpisu nebo instrukce. */
  text: string | null
  /** Přepis bodů pro tuto otázku v tomto testu. */
  pointsOverride: number | null
  /**
   * Přepis počtu linek na odpověď pro tuto otázku v tomto testu.
   * Prázdné (nebo chybějící u starších dat) = platí, co má otázka sama.
   */
  linesOverride?: number | null
  /**
   * Zmrazený obsah otázky jako JSON, tak jak vypadala při uložení testu.
   * Chybí jen u testů založených dřív, než se snímky zavedly.
   */
  questionSnapshot?: string | null
  /**
   * Zmrazený obsah hlavolamu jako JSON — ze stejného důvodu jako u otázky:
   * pozdější úprava hlavolamu nesmí změnit už vytištěnou písemku ani klíč.
   */
  puzzleSnapshot?: string | null
}

/**
 * Kolik linek na odpověď se má vytisknout. Přepis v testu má přednost před
 * tím, co si u otázky uložil model — místo na odpověď patří k písemce, ne
 * k otázce.
 */
export function answerLines(
  question: { type: string; payload: unknown },
  linesOverride: number | null | undefined,
): number {
  if (linesOverride && linesOverride > 0) return linesOverride
  const payload = question.payload as { lines?: number }
  return typeof payload.lines === 'number' ? payload.lines : 1
}

/* ------------------------------------------------- snímek otázky v testu */

/**
 * Snímek otázky zmrazený v okamžiku zařazení do testu. Je to týž tvar jako
 * obsah otázky (`questionContentSchema`) — druhá definice téhož by se dřív
 * nebo později rozešla. Metadata otázky (id, téma, stav) do snímku nepatří:
 * zajímá nás, co má žák na papíře, ne odkud to přišlo.
 *
 * Proč vůbec: bez snímku se hotová písemka tiše mění pokaždé, když učitelka
 * otázku v bance upraví — a klíč k odpovědím pak neodpovídá vytištěnému
 * zadání.
 */
export const questionSnapshotSchema = questionContentSchema

export type QuestionSnapshot = QuestionContent

/** Obsah otázky na snímek — zod zahodí metadata i cokoli navíc. */
export function toQuestionSnapshot(question: QuestionContent): QuestionSnapshot {
  return questionSnapshotSchema.parse(question)
}

/**
 * Snímek z uloženého JSON. Poškozený nebo neplatný snímek vrací `null` —
 * volající pak sáhne po živé otázce, místo aby se celý test rozsypal.
 */
export function parseQuestionSnapshot(raw: string | null | undefined): QuestionSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = questionSnapshotSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** Snímek k uložení do databáze. */
export function serializeQuestionSnapshot(question: QuestionContent): string {
  return JSON.stringify(toQuestionSnapshot(question))
}

/** Stabilní podoba pro porovnání — na pořadí klíčů v JSON nezáleží. */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Liší se živá otázka od snímku? Rozhraní podle toho umí u položky testu
 * klidně poznamenat, že otázka byla od zařazení upravena.
 */
export function snapshotDiffersFromQuestion(
  snapshot: QuestionSnapshot,
  question: QuestionContent,
): boolean {
  return stableKey(snapshot) !== stableKey(toQuestionSnapshot(question))
}

export interface Test {
  id: string
  title: string
  description: string | null
  /** Test na známky — bez toho se nevykreslují body ani políčko na známku. */
  graded: boolean
  templateId: string
  header: TestHeaderConfig
  /** 1 = jen varianta A, 2 = A i B. */
  variants: 1 | 2
  showKey: boolean
  createdAt: string
  updatedAt: string
}

/** Test připravený k vykreslení: položky mají navázané otázky. */
export interface ResolvedTestItem extends TestItem {
  /**
   * Vyplněno u `kind === 'question'`. Pochází ze snímku; živá otázka se
   * použije jen tam, kde snímek chybí nebo je poškozený.
   */
  question?: Question | null
  /** Živá otázka v bance se od snímku liší — test tiskne, co je ve snímku. */
  questionEdited?: boolean
  /** Otázka už v bance není; test žije dál ze snímku. */
  questionMissing?: boolean
  /** Vyplněno u `kind === 'puzzle'`; pochází ze snímku. */
  puzzle?: PuzzleContent | null
  /** Hlavolam už v knihovně není; test žije dál ze snímku. */
  puzzleMissing?: boolean
}

/**
 * Hlavolam položky testu: přednost má snímek, živý hlavolam slouží jako
 * záloha, když se snímek nepořídil nebo je poškozený. Stejné pravidlo jako
 * u otázky — na papíře má zůstat to, co se do písemky zařadilo.
 */
export function resolveTestItemPuzzle(
  rawSnapshot: string | null | undefined,
  live: Puzzle | null,
): Pick<ResolvedTestItem, 'puzzle' | 'puzzleMissing'> {
  const snapshot = parsePuzzleSnapshot(rawSnapshot)
  if (snapshot) return { puzzle: snapshot, puzzleMissing: !live }
  if (!live) return { puzzle: null, puzzleMissing: true }
  // Metadata (id, téma, časy) do obsahu položky nepatří; schéma je zahodí.
  return { puzzle: toPuzzleSnapshot(live), puzzleMissing: false }
}

/**
 * Otázka položky testu: přednost má snímek, živá otázka z banky slouží jen
 * jako záloha pro starší data a poškozené snímky. Metadata (id, téma, stav)
 * doplní živá otázka, pokud ještě existuje — ve snímku nejsou, protože
 * o vytištěné písemce nic nevypovídají.
 */
export function resolveTestItemQuestion(
  rawSnapshot: string | null | undefined,
  live: Question | null,
  fallbackId: string,
): Pick<ResolvedTestItem, 'question' | 'questionEdited' | 'questionMissing'> {
  const snapshot = parseQuestionSnapshot(rawSnapshot)
  if (!snapshot) {
    // Bez použitelného snímku zbývá živá otázka — nic se nerozbíjí, jen se
    // taková položka může s úpravou otázky změnit.
    return { question: live, questionEdited: false, questionMissing: false }
  }
  const question = {
    ...snapshot,
    id: live?.id ?? fallbackId,
    topicId: live?.topicId ?? null,
    materialId: live?.materialId ?? null,
    source: live?.source ?? 'ai',
    status: live?.status ?? 'approved',
    createdAt: live?.createdAt ?? '',
  } as Question

  return {
    question,
    questionEdited: Boolean(live) && snapshotDiffersFromQuestion(snapshot, live as Question),
    questionMissing: !live,
  }
}

export interface RenderableTest {
  test: Test
  template: Template
  items: ResolvedTestItem[]
  /** 'A' | 'B' — varianta B má přeházené pořadí. */
  variant: 'A' | 'B'
  /** Vykreslit klíč místo/za testem. */
  withKey: boolean
  /** Data obrázků použitých v testu (assetId → data URL). */
  assets: Record<string, string>
}

/** Celkový počet bodů testu. */
export function totalPoints(items: ResolvedTestItem[]): number {
  return items.reduce((sum, item) => {
    if (item.kind !== 'question' || !item.question) return sum
    return sum + (item.pointsOverride ?? item.question.points)
  }, 0)
}
