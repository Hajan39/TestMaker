import { describe, expect, it } from 'vitest'
import { runSummary } from '@/lib/queueSummary'

/**
 * The queue run result sentence. Guards mainly what it was made for: after only
 * errors no green "Hotovo" may show, and counts must be declined correctly.
 */

describe('queue run summary', () => {
  it('an empty queue is reported as neither success nor error', () => {
    expect(runSummary({ processed: 0, errors: 0, questions: 0 })).toEqual({
      tone: 'empty',
      text: 'Fronta byla prázdná, nic se negenerovalo.',
    })
  })

  it('when everything failed it is an error, not "Hotovo"', () => {
    const summary = runSummary({ processed: 7, errors: 7, questions: 0 })
    expect(summary.tone).toBe('error')
    expect(summary.text).toBe('Nepovedlo se ani jedno téma. Nedokončeno: 7 témat.')
    expect(summary.text).not.toContain('Hotovo')
  })

  it('a partial success says both and reads as a warning', () => {
    expect(runSummary({ processed: 7, errors: 2, questions: 8 })).toEqual({
      tone: 'warning',
      text: 'Hotovo: 8 otázek z 5 témat. Nedokončeno: 2 témata.',
    })
  })

  it('without errors reports only what was created', () => {
    expect(runSummary({ processed: 1, errors: 0, questions: 1 })).toEqual({
      tone: 'success',
      text: 'Hotovo: 1 otázka z 1 tématu.',
    })
  })

  it('counts are declined for two and three as well', () => {
    expect(runSummary({ processed: 3, errors: 0, questions: 2 }).text).toBe('Hotovo: 2 otázky z 3 témat.')
  })
})
