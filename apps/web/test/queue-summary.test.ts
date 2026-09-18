import { describe, expect, it } from 'vitest'
import { shrnutiBehu } from '@/lib/queueSummary'

/**
 * Věta o výsledku běhu fronty. Hlídá se hlavně to, kvůli čemu vznikla:
 * po samých chybách nesmí svítit zelené „Hotovo“ a počty se musí skloňovat.
 */

describe('shrnutí běhu fronty', () => {
  it('prázdná fronta se nehlásí jako úspěch ani jako chyba', () => {
    expect(shrnutiBehu({ zpracovano: 0, chyby: 0, otazky: 0 })).toEqual({
      ton: 'nic',
      text: 'Fronta byla prázdná, nic se negenerovalo.',
    })
  })

  it('když spadlo všechno, je to chyba a ne „Hotovo“', () => {
    const shrnuti = shrnutiBehu({ zpracovano: 7, chyby: 7, otazky: 0 })
    expect(shrnuti.ton).toBe('chyba')
    expect(shrnuti.text).toBe('Nepovedlo se ani jedno téma. Nedokončeno: 7 témat.')
    expect(shrnuti.text).not.toContain('Hotovo')
  })

  it('částečný úspěch řekne obojí a vyznívá jako varování', () => {
    expect(shrnutiBehu({ zpracovano: 7, chyby: 2, otazky: 8 })).toEqual({
      ton: 'varovani',
      text: 'Hotovo: 8 otázek z 5 témat. Nedokončeno: 2 témata.',
    })
  })

  it('bez chyb hlásí jen, co vzniklo', () => {
    expect(shrnutiBehu({ zpracovano: 1, chyby: 0, otazky: 1 })).toEqual({
      ton: 'uspech',
      text: 'Hotovo: 1 otázka z 1 tématu.',
    })
  })

  it('počty se skloňují i u dvojky a trojky', () => {
    expect(shrnutiBehu({ zpracovano: 3, chyby: 0, otazky: 2 }).text).toBe('Hotovo: 2 otázky z 3 témat.')
  })
})
