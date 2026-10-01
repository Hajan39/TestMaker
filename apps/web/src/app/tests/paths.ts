import type { TestKind } from '@testmaker/core/schema'

/**
 * Written tests live under `/tests`, worksheets under `/listy`. One place for
 * both routes so links from the overview, the editor and copies point where
 * they belong.
 */
export function overviewPath(kind: TestKind): string {
  return kind === 'pracovni_list' ? '/listy' : '/tests'
}

export function testPath(kind: TestKind, id: string): string {
  return `${overviewPath(kind)}/${id}`
}
