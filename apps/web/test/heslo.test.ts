import { describe, expect, it } from 'vitest'
import { MIN_DELKA_HESLA, overitHeslo, vygenerovatHeslo, zahesovat, zkontrolovatSilu } from '@/lib/heslo'

describe('hesla účtů', () => {
  it('uložený záznam heslo neprozradí a dá se jím ověřit', async () => {
    const zaznam = await zahesovat('tajne-heslo-ucitelky')
    expect(zaznam).not.toContain('tajne-heslo-ucitelky')
    expect(zaznam.startsWith('scrypt$')).toBe(true)
    await expect(overitHeslo('tajne-heslo-ucitelky', zaznam)).resolves.toBe(true)
    await expect(overitHeslo('jine-heslo', zaznam)).resolves.toBe(false)
  })

  it('dvakrát totéž heslo dá dva různé záznamy (jiná sůl)', async () => {
    const a = await zahesovat('tajne-heslo-ucitelky')
    const b = await zahesovat('tajne-heslo-ucitelky')
    expect(a).not.toBe(b)
    await expect(overitHeslo('tajne-heslo-ucitelky', b)).resolves.toBe(true)
  })

  it('poškozený nebo chybějící záznam znamená „neodpovídá“, ne výjimku', async () => {
    await expect(overitHeslo('cokoli', null)).resolves.toBe(false)
    await expect(overitHeslo('cokoli', '')).resolves.toBe(false)
    await expect(overitHeslo('cokoli', 'scrypt$nesmysl')).resolves.toBe(false)
    await expect(overitHeslo('cokoli', 'bcrypt$1$2$3$4$5')).resolves.toBe(false)
  })

  it('krátké heslo a heslo s mezerami na krajích se odmítnou česky', () => {
    expect(zkontrolovatSilu('krátké')).toContain(String(MIN_DELKA_HESLA))
    expect(zkontrolovatSilu(' heslo s mezerou ')).toContain('mezerou')
    expect(zkontrolovatSilu('dost-dlouhe-heslo')).toBeNull()
  })

  it('vygenerované heslo je dost dlouhé a dá se nadiktovat', async () => {
    const heslo = vygenerovatHeslo()
    expect(zkontrolovatSilu(heslo)).toBeNull()
    expect(heslo).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/)
    // Znaky, které se v diktování pletou, v něm nejsou.
    expect(heslo).not.toMatch(/[01ilo]/)
  })
})
