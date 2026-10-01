import { describe, expect, it } from 'vitest'
import { planUndo } from '../src'

describe('planUndo', () => {
  it('empty input yields no step', () => {
    expect(planUndo([])).toEqual([])
  })

  it('groups ids by the status to return to', () => {
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

  it('the same status for all means a single step', () => {
    expect(planUndo([
      ['q1', 'draft'],
      ['q2', 'draft'],
    ])).toEqual([{ status: 'draft', ids: ['q1', 'q2'] }])
  })

  it('group and id order follows the input order', () => {
    const plan = planUndo([
      ['q9', 'rejected'],
      ['q8', 'draft'],
      ['q7', 'rejected'],
    ])

    expect(plan.map((step) => step.status)).toEqual(['rejected', 'draft'])
    expect(plan[0]!.ids).toEqual(['q9', 'q7'])
  })

  it('a repeated id counts once and its first status wins', () => {
    const plan = planUndo([
      ['q1', 'draft'],
      ['q1', 'approved'],
    ])

    expect(plan).toEqual([{ status: 'draft', ids: ['q1'] }])
  })

  it('also accepts a map of previous statuses as the panel holds it', () => {
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
