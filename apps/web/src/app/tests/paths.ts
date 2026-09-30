import type { TestKind } from '@testmaker/core/schema'

/**
 * Písemky žijí pod `/tests`, pracovní listy pod `/listy`. Jedno místo pro
 * obě trasy, aby odkazy z přehledu, editoru i kopie mířily tam, kam patří.
 */
export function overviewPath(kind: TestKind): string {
  return kind === 'pracovni_list' ? '/listy' : '/tests'
}

export function testPath(kind: TestKind, id: string): string {
  return `${overviewPath(kind)}/${id}`
}
