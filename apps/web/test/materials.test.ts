import { describe, expect, it } from 'vitest'
import { isUsableMaterial } from '@/lib/materials'

const base = { duplicateOfId: null, excluded: false, needsOcr: false }

describe('isUsableMaterial', () => {
  it('běžný materiál je použitelný', () => {
    expect(isUsableMaterial(base)).toBe(true)
  })

  it('duplicitní materiál použitelný není', () => {
    expect(isUsableMaterial({ ...base, duplicateOfId: 'jiny-id' })).toBe(false)
  })

  it('ručně vyřazený materiál použitelný není', () => {
    expect(isUsableMaterial({ ...base, excluded: true })).toBe(false)
  })

  it('sken bez textové vrstvy (needsOcr) použitelný není', () => {
    expect(isUsableMaterial({ ...base, needsOcr: true })).toBe(false)
  })
})
