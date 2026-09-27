import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, promptRules, schools, users } from '@/db'
import {
  MAX_ACTIVE_PROMPT_RULES,
  PrilisMnohoPravidel,
  createPromptRule,
  loadActivePromptRules,
  loadPromptRules,
  setPromptRuleActive,
} from '@/lib/promptRules'
import { newId } from '@/lib/ids'
import type { Scope } from '@/lib/uzivatel'
import { UCET } from './helpers'

/**
 * Pravidla promptu školy: aktivní se dostanou do generování, vypnutá ne,
 * cizí školy nikdy — a aktivních smí být nejvýš deset (bod revize 5, úkol 4).
 */

const CIZI_SKOLA = 'skola-jina-pravidla'

/** Účet skutečně jiné školy — pro test, že se pravidla mezi školami nepletou. */
async function ciziScope(): Promise<Scope> {
  await db.insert(schools).values({ id: CIZI_SKOLA, name: 'Jiná škola', slug: 'jina-pravidla' }).onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({ id, schoolId: CIZI_SKOLA, email: `${id}@jina.cz`, name: 'Cizí správce', role: 'spravce' })
  return { schoolId: CIZI_SKOLA, userId: id, role: 'spravce' }
}

beforeEach(async () => {
  await db.delete(promptRules)
})

describe('createPromptRule', () => {
  it('založí aktivní pravidlo s ořízlým textem', async () => {
    const dlouhy = 'x'.repeat(400)
    const pravidlo = await createPromptRule(UCET, { text: dlouhy })
    expect(pravidlo.active).toBe(true)
    expect(pravidlo.text).toHaveLength(300)
  })

  it('prázdný text (i po ořezu mezer) se odmítne', async () => {
    await expect(createPromptRule(UCET, { text: '   ' })).rejects.toThrow(/prázdné/)
  })

  it('vnitřní mezery a odřádkování se sjednotí na jednu mezeru', async () => {
    // Textarea ve Správě dovolí i víc řádků; jako odrážka v systémovém
    // promptu (`- ${rule}`) i v hlavičce staženého souboru pro `/otazky` musí
    // pravidlo zůstat na jednom řádku, jinak by odrážky rozbilo.
    const pravidlo = await createPromptRule(UCET, { text: '  Piš   krátce\n\na  jasně.  ' })
    expect(pravidlo.text).toBe('Piš krátce a jasně.')
  })

  it('jedenácté aktivní pravidlo se odmítne českou hláškou', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(UCET, { text: `Pravidlo ${i}` })
    }
    await expect(createPromptRule(UCET, { text: 'Jedenácté' })).rejects.toThrow(PrilisMnohoPravidel)
    await expect(createPromptRule(UCET, { text: 'Jedenácté' })).rejects.toThrow(/nejvýš 10/)
  })
})

describe('setPromptRuleActive', () => {
  it('vypnuté pravidlo zmizí z aktivních, zapnuté se zase objeví', async () => {
    const pravidlo = await createPromptRule(UCET, { text: 'Piš krátce.' })
    expect(await loadActivePromptRules(UCET)).toEqual(['Piš krátce.'])

    await setPromptRuleActive(UCET, pravidlo.id, false)
    expect(await loadActivePromptRules(UCET)).toEqual([])

    await setPromptRuleActive(UCET, pravidlo.id, true)
    expect(await loadActivePromptRules(UCET)).toEqual(['Piš krátce.'])
  })

  it('cizí pravidlo se tváří jako neexistující', async () => {
    const pravidlo = await createPromptRule(UCET, { text: 'Moje pravidlo' })
    const cizi = { ...UCET, schoolId: CIZI_SKOLA }
    expect(await setPromptRuleActive(cizi, pravidlo.id, false)).toBe(false)

    const [radek] = await db.select().from(promptRules).where(eq(promptRules.id, pravidlo.id))
    expect(radek?.active).toBe(true)
  })

  it('opětovné uložení už aktivního pravidla jako aktivní na hranici deseti neselže', async () => {
    const prvni = await createPromptRule(UCET, { text: 'První' })
    for (let i = 1; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(UCET, { text: `Pravidlo ${i}` })
    }
    // Deset aktivních už je — uložit znovu jako aktivní to první nesmí spadnout.
    await expect(setPromptRuleActive(UCET, prvni.id, true)).resolves.toBe(true)
  })

  it('zapnutí jedenáctého se odmítne stejně jako založení', async () => {
    for (let i = 0; i < MAX_ACTIVE_PROMPT_RULES; i++) {
      await createPromptRule(UCET, { text: `Pravidlo ${i}` })
    }
    // Vypnuté pravidlo vzniklo dřív, než se aktivních naplnilo deset —
    // `createPromptRule` by jedenácté rovnou aktivní vůbec nezaložilo.
    const id = 'vypnute-jedenacte'
    await db.insert(promptRules).values({
      id,
      schoolId: UCET.schoolId,
      text: 'Vypnuté',
      active: false,
      createdBy: UCET.userId,
    })
    await expect(setPromptRuleActive(UCET, id, true)).rejects.toThrow(PrilisMnohoPravidel)
  })
})

describe('loadActivePromptRules a loadPromptRules', () => {
  it('cizí škola nikdy — ani ve výpisu pro Správu, ani v aktivních pro prompt', async () => {
    const cizi = await ciziScope()
    await createPromptRule(cizi, { text: 'Cizí pravidlo' })

    expect(await loadActivePromptRules(UCET)).toEqual([])
    expect(await loadPromptRules(UCET)).toEqual([])
  })

  it('výpis pro Správu ukáže aktivní i vypnutá pravidla', async () => {
    const aktivni = await createPromptRule(UCET, { text: 'Aktivní' })
    const vypnute = await createPromptRule(UCET, { text: 'Vypnuté' })
    await setPromptRuleActive(UCET, vypnute.id, false)

    const seznam = await loadPromptRules(UCET)
    expect(seznam.find((p) => p.id === aktivni.id)?.active).toBe(true)
    expect(seznam.find((p) => p.id === vypnute.id)?.active).toBe(false)
  })
})
