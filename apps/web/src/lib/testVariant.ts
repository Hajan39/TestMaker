import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, questions, testItems } from '@/db'
import { skola, type Scope } from '@/lib/uzivatel'
import { createVariant } from '@/lib/generation'
import { loadVariantLinks } from '@/lib/questions'
import { buildQuestionSnapshots, copyTest } from '@/lib/tests'

export type TestVariantDirection = 'easier' | 'harder'

export interface TestVariantOutcome {
  testId: string
  /** Kolik položek dostalo už existující verzi kořenové otázky. */
  replaced: number
  /** Kolik položek dostalo čerstvě vygenerovanou verzi. */
  generated: number
  /** Kolik položek zůstalo u původní otázky (hranice obtížnosti, zaneprázdněné téma, selhání modelu). */
  kept: number
}

/** Název nové písemky — vždycky z uloženého názvu zdroje, ne z rozpracované úpravy v editoru. */
export function testVariantTitle(sourceTitle: string, direction: TestVariantDirection): string {
  return `${sourceTitle} – ${direction === 'easier' ? 'lehčí' : 'těžší'}`
}

/**
 * Vytvoří lehčí nebo těžší verzi celé písemky: kopii testu, ve které je
 * každá otázková položka nahrazená verzí kořenové otázky o stupeň lehčí nebo
 * těžší.
 *
 * Kopie vzniká hned na začátku (`copyTest`) — jakmile existuje, žádná chyba
 * u jednotlivé položky ji neruší, jen položka zůstane u původní otázky.
 * Selže jen předběžná kontrola (zdrojový test není vidět); pak nevznikne nic.
 *
 * Pro každou položku druhu `question` s otázkou z banky:
 * 1. Najde se kořen (`variantOf` původní otázky, nebo otázka sama).
 * 2. Mezi verzemi kořene s obtížností `původní ± 1` a stavem jiným než
 *    `rejected` se hledá ta, která se dá použít rovnou (`replaced`).
 * 3. Když žádná není, zkusí se `createVariant` (`generated`). Selže-li —
 *    hranice obtížnosti, zaneprázdněné téma, nebo model — položka zůstane
 *    beze změny (`kept`) a pokračuje se dál.
 *
 * Položka bez otázky z banky (`questionId` null, otázka smazaná natvrdo) a
 * hlavolam zůstávají beze změny a do součtů se nepočítají.
 */
export async function createTestVariant(
  scope: Scope,
  testId: string,
  direction: TestVariantDirection,
  options: {
    onStart?: (total: number) => void
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    /** Podvržené generování pro testy; v aplikaci se nepředává. */
    generate?: typeof generateQuestions
  } = {},
): Promise<TestVariantOutcome> {
  const copy = await copyTest(scope, testId, { title: (title) => testVariantTitle(title, direction) })
  if (!copy) throw new Error('Test se nenašel')

  // Pořadí na papíře — `copyTest` sice vrací položky ve stejném pořadí, v jakém
  // je uložil, ale bez tahu přes `position` by se řazení lámalo, kdyby to
  // jednou přestala být pravda.
  const orderedItems = await db
    .select({ id: testItems.id, kind: testItems.kind, questionId: testItems.questionId })
    .from(testItems)
    .where(and(skola(scope, testItems), eq(testItems.testId, copy.id)))
    .orderBy(asc(testItems.position))

  const total = orderedItems.length
  options.onStart?.(total)

  let replaced = 0
  let generated = 0
  let kept = 0
  let done = 0

  for (const item of orderedItems) {
    if (item.kind !== 'question' || !item.questionId) {
      done += 1
      options.onProgress?.(done, total)
      continue
    }

    const [original] = await db
      .select({ difficulty: questions.difficulty, variantOf: questions.variantOf })
      .from(questions)
      .where(and(skola(scope, questions), eq(questions.id, item.questionId)))
      .limit(1)
    if (!original) {
      // Otázka z banky natvrdo zmizela — nemá se z čeho vzít nová verze.
      done += 1
      options.onProgress?.(done, total)
      continue
    }

    const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
    const targetDifficulty = originalDifficulty + (direction === 'easier' ? -1 : 1)
    const root = original.variantOf ?? item.questionId

    let replacementId: string | null = null
    if (targetDifficulty >= 1 && targetDifficulty <= 3) {
      const links = await loadVariantLinks(scope, [root])
      const existing = (links[root] ?? []).find(
        (link) => link.difficulty === targetDifficulty && link.status !== 'rejected',
      )
      if (existing) {
        replacementId = existing.id
        replaced += 1
      }
    }

    if (!replacementId) {
      try {
        const variant = await createVariant(scope, item.questionId, direction, {
          signal: options.signal,
          generate: options.generate,
        })
        replacementId = variant.id
        generated += 1
      } catch {
        // Hranice obtížnosti, zaneprázdněné téma nebo selhání modelu — položka
        // zůstává u původní otázky a verze písemky pokračuje dál.
        kept += 1
      }
    }

    if (replacementId) {
      const snapshots = await buildQuestionSnapshots(scope, [replacementId])
      await db
        .update(testItems)
        .set({ questionId: replacementId, questionSnapshot: snapshots.get(replacementId) ?? null })
        .where(and(skola(scope, testItems), eq(testItems.id, item.id)))
    }

    done += 1
    options.onProgress?.(done, total)
  }

  return { testId: copy.id, replaced, generated, kept }
}
