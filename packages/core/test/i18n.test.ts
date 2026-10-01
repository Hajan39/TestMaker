import { describe, expect, it } from 'vitest'
import { t } from '../src/i18n'

describe('translations', () => {
  it('uses Czech plural forms', () => {
    expect(t('items', { count: 1 })).toBe('1 položka')
    expect(t('items', { count: 3 })).toBe('3 položky')
    expect(t('items', { count: 5 })).toBe('5 položek')
  })
})
