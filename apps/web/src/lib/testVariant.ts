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
 *    `rejected` se hledá ta, která se dá použít rovnou (`replaced`) — a která
 *    v kopii ještě není, aby žádná otázka nestála na papíře dvakrát.
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
    /** Volá se, jakmile kopie existuje — s jejím id, aby o ni klient nepřišel, kdyby průběh spadl. */
    onStart?: (total: number, testId: string) => void
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
  options.onStart?.(total, copy.id)

  // Které otázky v kopii právě jsou (s počtem výskytů). Náhrada se vybírá jen
  // z otázek, které v kopii ještě nejsou — jinak by dvě položky, třeba
  // originál a jeho lehčí verze, skončily u téže otázky a na papíře by stála
  // dvakrát.
  const vKopii = new Map<string, number>()
  const pridej = (id: string) => vKopii.set(id, (vKopii.get(id) ?? 0) + 1)
  const uber = (id: string) => {
    const pocet = (vKopii.get(id) ?? 0) - 1
    if (pocet > 0) vKopii.set(id, pocet)
    else vKopii.delete(id)
  }
  for (const item of orderedItems) {
    if (item.kind === 'question' && item.questionId) pridej(item.questionId)
  }

  let replaced = 0
  let generated = 0
  let kept = 0
  let done = 0

  for (const item of orderedItems) {
    if (options.signal?.aborted) break
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
      // Kandidáti jsou sourozenci kořene (`loadVariantLinks`) i kořen sám —
      // otázka v testu nemusí být kořenem svých verzí (může to být třeba
      // těžší verze, kterou teď chceme zase zlehčit), a v tom případě je
      // kandidátem na požadovanou obtížnost klidně kořen sám.
      const candidates: { id: string; difficulty: number; status: string }[] = []
      if (root !== item.questionId) {
        const [rootRow] = await db
          .select({ id: questions.id, difficulty: questions.difficulty, status: questions.status })
          .from(questions)
          .where(and(skola(scope, questions), eq(questions.id, root)))
          .limit(1)
        if (rootRow) candidates.push({ id: rootRow.id, difficulty: rootRow.difficulty ?? 2, status: rootRow.status })
      }
      const links = await loadVariantLinks(scope, [root])
      candidates.push(...(links[root] ?? []))

      const existing = candidates.find(
        (candidate) =>
          candidate.id !== item.questionId &&
          !vKopii.has(candidate.id) &&
          candidate.status !== 'rejected' &&
          candidate.difficulty === targetDifficulty,
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
      // Zrušení mohlo přijít až uprostřed volání modelu — nemá smysl začínat
      // další položku, když už nikdo na výsledek nečeká.
      if (options.signal?.aborted) break
    }

    if (replacementId) {
      uber(item.questionId)
      pridej(replacementId)
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
