import { describe, expect, it } from 'vitest'
import { MATERIALY, OTAZKY, TEMATA, plural, pocet } from '../src/plural'

describe('skloňování počtů', () => {
  it('jedna dostane první tvar', () => {
    expect(plural(1, 'téma', 'témata', 'témat')).toBe('téma')
  })

  it('dvě až čtyři dostanou druhý tvar', () => {
    expect(plural(2, 'téma', 'témata', 'témat')).toBe('témata')
    expect(plural(3, 'téma', 'témata', 'témat')).toBe('témata')
    expect(plural(4, 'téma', 'témata', 'témat')).toBe('témata')
  })

  it('pět a víc dostane třetí tvar', () => {
    expect(plural(5, 'téma', 'témata', 'témat')).toBe('témat')
    expect(plural(29, 'téma', 'témata', 'témat')).toBe('témat')
    expect(plural(101, 'téma', 'témata', 'témat')).toBe('témat')
  })

  // Nejčastější chyba kopírovaných pomocných funkcí: podmínka `count < 5`
  // pustila nulu mezi „2–4“ a v rozhraní svítilo „0 otázky“.
  it('nula patří ke tvaru pro pět a víc', () => {
    expect(plural(0, 'otázka', 'otázky', 'otázek')).toBe('otázek')
    expect(pocet(0, OTAZKY)).toBe('0 otázek')
  })

  it('záporné číslo nespadne do tvaru pro dvě až čtyři', () => {
    expect(plural(-3, 'otázka', 'otázky', 'otázek')).toBe('otázek')
  })

  it('pocet složí číslo se slovem', () => {
    expect(pocet(1, OTAZKY)).toBe('1 otázka')
    expect(pocet(3, OTAZKY)).toBe('3 otázky')
    expect(pocet(29, OTAZKY)).toBe('29 otázek')
    expect(pocet(1, TEMATA)).toBe('1 téma')
    expect(pocet(5, TEMATA)).toBe('5 témat')
    expect(pocet(2, MATERIALY)).toBe('2 materiály')
  })
})
