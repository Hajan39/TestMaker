import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, verifyPassword, generatePassword, hashPassword, checkPasswordStrength } from '@/lib/password'

describe('account passwords', () => {
  it('the stored entry does not reveal the password and verifies it', async () => {
    const entry = await hashPassword('tajne-heslo-ucitelky')
    expect(entry).not.toContain('tajne-heslo-ucitelky')
    expect(entry.startsWith('scrypt$')).toBe(true)
    await expect(verifyPassword('tajne-heslo-ucitelky', entry)).resolves.toBe(true)
    await expect(verifyPassword('jine-heslo', entry)).resolves.toBe(false)
  })

  it('the same password twice gives two different entries (different salt)', async () => {
    const a = await hashPassword('tajne-heslo-ucitelky')
    const b = await hashPassword('tajne-heslo-ucitelky')
    expect(a).not.toBe(b)
    await expect(verifyPassword('tajne-heslo-ucitelky', b)).resolves.toBe(true)
  })

  it('a damaged or missing entry means "does not match", not an exception', async () => {
    await expect(verifyPassword('cokoli', null)).resolves.toBe(false)
    await expect(verifyPassword('cokoli', '')).resolves.toBe(false)
    await expect(verifyPassword('cokoli', 'scrypt$nesmysl')).resolves.toBe(false)
    await expect(verifyPassword('cokoli', 'bcrypt$1$2$3$4$5')).resolves.toBe(false)
  })

  it('a short password and one with surrounding spaces are rejected with a message', () => {
    expect(checkPasswordStrength('krátké')).toContain(String(MIN_PASSWORD_LENGTH))
    expect(checkPasswordStrength(' heslo s mezerou ')).toContain('mezerou')
    expect(checkPasswordStrength('dost-dlouhe-heslo')).toBeNull()
  })

  it('a generated password is long enough and can be dictated', async () => {
    const password = generatePassword()
    expect(checkPasswordStrength(password)).toBeNull()
    expect(password).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/)
    // Characters that get confused when dictating are not in it.
    expect(password).not.toMatch(/[01ilo]/)
  })
})
