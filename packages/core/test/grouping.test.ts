import { describe, expect, it } from 'vitest'
import {
  findMatchingTopic,
  groupForImport,
  preferredTopicName,
  sameTopic,
  topicTokens,
} from '../src/extract/grouping'

describe('topicTokens', () => {
  it('zahodí čísla, diakritiku a balast', () => {
    expect(topicTokens('6.22 Měkkýši (Mollusca)')).toEqual(['mekkysi', 'mollusca'])
    expect(topicTokens('test- hlísti')).toEqual(['hlisti'])
    expect(topicTokens('prirodopis-6_pl-bezobratli-viry._test_2018')).toContain('viry')
  })
})

describe('sameTopic', () => {
  it('sloučí zkrácený a rozepsaný název', () => {
    expect(sameTopic('Měkkýši', '6.22 Měkkýši (Mollusca) - PLŽI, MLŽI, HLAVONOŽCI 6.23')).toBe(true)
    expect(sameTopic('6.21 Hlísti', 'test- hlísti')).toBe(true)
    expect(sameTopic('Savci', '7.9 Savci')).toBe(true)
    expect(sameTopic('Poznávačka - ryby', '7.5 Ryby')).toBe(true)
  })

  it('nesloučí různá témata', () => {
    expect(sameTopic('Buňka', 'Buňky a tkáně')).toBe(false)
    expect(sameTopic('Dýchací soustava', 'Trávicí soustava')).toBe(false)
    expect(sameTopic('Vyvřelé magmatické horniny', 'Usazené sedimentární horniny')).toBe(false)
  })

  it('přídavné jméno bez oddělovače dělá z obecného tématu jinou látku', () => {
    // Reálný případ přesloučení z knihovny: téma "Rostliny" spojilo obecný
    // úvod (7.11) se samostatnou lekcí o výtrusných rostlinách (7.13) a
    // s materiály o kapraďorostech/mechorostech, protože všechny obsahují
    // slovo "rostliny". Jde ale o čtyři různé lekce.
    expect(sameTopic('Rostliny', 'Výtrusné rostliny')).toBe(false)
    expect(sameTopic('Rostliny', 'vyšší rostliny - kapraďorosty')).toBe(false)
    expect(sameTopic('Rostliny', 'vyšší rostliny - ryniofyty a mechorosty')).toBe(false)
  })

  it('doplněk oddělený pomlčkou/závorkou/čárkou patří k témuž tématu', () => {
    // Skutečné názvy z knihovny: "Měkkýši" a jeho rozepsaná verze, "Viry" a
    // jeho pracovní listy — tady se sloučit MAJÍ, protože přídavná slova
    // jsou oddělená (apozice), ne přilepený přívlastek.
    expect(sameTopic('Měkkýši', '6.22 Měkkýši (Mollusca) - PLŽI, MLŽI, HLAVONOŽCI 6.23')).toBe(true)
    expect(sameTopic('Viry', 'viry-poznávačka')).toBe(true)
    expect(sameTopic('Viry', 'prirodopis-6_pl-bezobratli-viry_test_2018')).toBe(true)
  })

  it('název bez významových slov nesloučí nic', () => {
    expect(sameTopic('test', 'Hlísti')).toBe(false)
  })
})

describe('findMatchingTopic', () => {
  const existing = [{ name: 'Oběhová soustava' }, { name: 'Dýchací soustava' }, { name: 'Trávicí soustava' }]

  it('najde odpovídající téma', () => {
    expect(findMatchingTopic(existing, 'Oběhová soustava- krevní oběh')?.name).toBe('Oběhová soustava')
    expect(findMatchingTopic(existing, '11. Dýchací soustava')?.name).toBe('Dýchací soustava')
  })

  it('vrátí null, když nic nesedí', () => {
    expect(findMatchingTopic(existing, 'Genetika')).toBeNull()
  })
})

describe('preferredTopicName', () => {
  it('stručnější název vyhrává', () => {
    expect(preferredTopicName('Měkkýši', 'Měkkýši (Mollusca) - PLŽI, MLŽI')).toBe('Měkkýši')
  })
})

describe('obecný název nespojuje nesouvisející lekce', () => {
  const mineraly = [
    { name: '2. mineralogická třída sulfidy' },
    { name: '3. mineralogická třída - halogenidy' },
    { name: '4. mineralogická třída - oxidy' },
  ]

  it('název bez rozlišujícího slova zůstane samostatný', () => {
    expect(findMatchingTopic(mineraly, '6. mineralogická třída')).toBeNull()
  })

  it('název s rozlišujícím slovem se připojí ke své lekci', () => {
    expect(findMatchingTopic(mineraly, 'mineralogická třída - oxidy zápis')?.name).toBe(
      '4. mineralogická třída - oxidy',
    )
  })

  it('několik souvisejících souborů se spojí do jedné skupiny', () => {
    const viry = [{ name: '6.11 Viry' }, { name: 'Viry' }]
    expect(findMatchingTopic(viry, 'prirodopis-6_pl-bezobratli-viry test')?.name).toBeTruthy()
  })
})

describe('reálný případ z knihovny: "Rostliny" (7. ročník)', () => {
  // Toto téma v knihovně dosud spojovalo obecný úvod (7.11) se samostatnou
  // lekcí o výtrusných rostlinách (7.13) a s materiály o vyšších rostlinách —
  // čtyři různé lekce jen proto, že název obsahuje slovo "rostliny".
  const existing = [{ name: 'Rostliny' }]

  it('samostatná lekce o výtrusných rostlinách se nepřipojí k obecnému úvodu', () => {
    expect(findMatchingTopic(existing, '7.13 Výtrusné rostliny')).toBeNull()
  })

  it('export prezentace stejné lekce se připojí', () => {
    expect(findMatchingTopic(existing, '7.11 Rostliny prezentace')?.name).toBe('Rostliny')
  })
})

describe('groupForImport', () => {
  /** Zkratka: zařazení tak, jak ho z cesty odhadne `parsePath`. */
  function place(subject: string, grade: string | null, topic: string) {
    return { subject, grade, topic }
  }

  it('spojí soubory téhož tématu a nechá skupině srozumitelnější název', () => {
    const groups = groupForImport([
      place('PŘÍRODOPIS', '6. ročník', '6.22 Měkkýši (Mollusca)'),
      place('PŘÍRODOPIS', '6. ročník', 'Měkkýši'),
      place('PŘÍRODOPIS', '6. ročník', 'Hlísti'),
    ])

    expect(groups).toHaveLength(2)
    const mekkysi = groups.find((group) => group.topic === 'Měkkýši')
    expect(mekkysi?.files).toHaveLength(2)
    expect(groups.find((group) => group.topic === 'Hlísti')?.files).toHaveLength(1)
  })

  it('stejné téma ve dvou ročnících zůstane dvěma skupinami', () => {
    const groups = groupForImport([
      place('PŘÍRODOPIS', '7. ročník', 'Savci'),
      place('PŘÍRODOPIS', '8. ročník', 'Savci'),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.grade)).toEqual(['7. ročník', '8. ročník'])
  })

  it('samostatný soubor bez složky skončí bez zařazení, ale s názvem tématu', () => {
    const groups = groupForImport([place('Nezařazeno', null, 'Opakování - zlomky')])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ subject: '', grade: '', topic: 'Opakování - zlomky' })
  })

  it('nezařazené skupiny jdou první, zbytek abecedně', () => {
    const groups = groupForImport([
      place('ZEMĚPIS', '9. ročník', 'Afrika'),
      place('Nezařazeno', null, 'Pracovní list'),
      place('PŘÍRODOPIS', '6. ročník', 'Viry'),
    ])

    expect(groups.map((group) => group.subject)).toEqual(['', 'PŘÍRODOPIS', 'ZEMĚPIS'])
  })

  it('zachová i data navíc, aby šel z náhledu poslat celý materiál', () => {
    const groups = groupForImport([
      { ...place('PŘÍRODOPIS', '6. ročník', 'Viry'), fileName: 'Viry.pdf', charCount: 4200 },
    ])

    expect(groups[0]?.files[0]?.fileName).toBe('Viry.pdf')
  })

  it('prázdný vstup dá prázdný seznam skupin', () => {
    expect(groupForImport([])).toEqual([])
  })
})
