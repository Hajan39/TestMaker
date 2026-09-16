import { describe, expect, it } from 'vitest'
import { planUndo } from '../src'

describe('planUndo', () => {
  it('z prázdného vstupu nevznikne žádný krok', () => {
    expect(planUndo([])).toEqual([])
  })

  it('seskupí id podle stavu, do kterého se mají vrátit', () => {
    const plan = planUndo([
      ['q1', 'draft'],
      ['q2', 'approved'],
      ['q3', 'draft'],
    ])

    expect(plan).toEqual([
      { status: 'draft', ids: ['q1', 'q3'] },
      { status: 'approved', ids: ['q2'] },
    ])
  })

  it('stejný stav pro všechny znamená jediný krok', () => {
    expect(planUndo([
      ['q1', 'draft'],
      ['q2', 'draft'],
    ])).toEqual([{ status: 'draft', ids: ['q1', 'q2'] }])
  })

  it('pořadí skupin i id odpovídá pořadí vstupu', () => {
    const plan = planUndo([
      ['q9', 'rejected'],
      ['q8', 'draft'],
      ['q7', 'rejected'],
    ])

    expect(plan.map((step) => step.status)).toEqual(['rejected', 'draft'])
    expect(plan[0]!.ids).toEqual(['q9', 'q7'])
  })

  it('opakované id se započítá jen jednou a platí jeho první stav', () => {
    const plan = planUndo([
      ['q1', 'draft'],
      ['q1', 'approved'],
    ])

    expect(plan).toEqual([{ status: 'draft', ids: ['q1'] }])
  })

  it('bere i mapu předchozích stavů, jak ji drží panel', () => {
    const previous = new Map<string, 'draft' | 'approved' | 'rejected'>([
      ['q1', 'draft'],
      ['q2', 'rejected'],
    ])

    expect(planUndo(previous)).toEqual([
      { status: 'draft', ids: ['q1'] },
      { status: 'rejected', ids: ['q2'] },
    ])
  })
})
