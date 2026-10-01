import { describe, expect, it } from 'vitest'
import { isUsableMaterial } from '@/lib/materials'

const base = { duplicateOfId: null, excluded: false, needsOcr: false }

describe('isUsableMaterial', () => {
  it('a regular material is usable', () => {
    expect(isUsableMaterial(base)).toBe(true)
  })

  it('a duplicate material is not usable', () => {
    expect(isUsableMaterial({ ...base, duplicateOfId: 'jiny-id' })).toBe(false)
  })

  it('a manually excluded material is not usable', () => {
    expect(isUsableMaterial({ ...base, excluded: true })).toBe(false)
  })

  it('a scan without a text layer (needsOcr) is not usable', () => {
    expect(isUsableMaterial({ ...base, needsOcr: true })).toBe(false)
  })
})
