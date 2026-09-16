/**
 * Plán vrácení hromadné akce.
 *
 * Když učitelka schválí nebo zamítne desítky otázek naráz, měly ty otázky
 * předtím různé stavy — něco byl koncept, něco už bylo schválené. „Vzít zpět“
 * proto nemůže poslat jeden stav pro všechny; musí je vrátit po skupinách.
 * Tahle funkce z poznamenaných předchozích stavů takové skupiny sestaví.
 *
 * Záměrně je tu čistá funkce bez Reactu a bez fetche: dá se na ni napsat test
 * a volající si zápis na server udělá sám.
 */

/** Stav otázky, jak ho zná schéma otázek. Opsaný sem, aby balíček zůstal bez závislosti. */
export type UndoStatus = 'draft' | 'approved' | 'rejected'

export interface UndoStep<Status extends string = UndoStatus> {
  status: Status
  ids: string[]
}

/**
 * Seskupí id podle stavu, do kterého se mají vrátit. Pořadí skupin i id v nich
 * odpovídá pořadí vstupu, aby se výsledek dal porovnat v testu a aby se zápisy
 * na server odehrály v pořadí, ve kterém učitelka otázky vybrala.
 *
 * Duplicitní id se započítá jen jednou — rozhoduje první výskyt, protože ten
 * nese stav před akcí; pozdější už by mohl být stav po ní.
 */
export function planUndo<Status extends string = UndoStatus>(
  previous: Iterable<readonly [string, Status]>,
): UndoStep<Status>[] {
  const steps: UndoStep<Status>[] = []
  const byStatus = new Map<Status, UndoStep<Status>>()
  const seen = new Set<string>()

  for (const [id, status] of previous) {
    if (seen.has(id)) continue
    seen.add(id)

    let step = byStatus.get(status)
    if (!step) {
      step = { status, ids: [] }
      byStatus.set(status, step)
      steps.push(step)
    }
    step.ids.push(id)
  }

  return steps
}
