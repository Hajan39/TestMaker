import { describe, expect, it } from 'vitest'
import {
  findMatchingTopic,
  groupForImport,
  preferredTopicName,
  sameTopic,
  topicTokens,
} from '../src/extract/grouping'

describe('topicTokens', () => {
  it('drops numbers, diacritics and filler', () => {
    expect(topicTokens('6.22 Měkkýši (Mollusca)')).toEqual(['mekkysi', 'mollusca'])
    expect(topicTokens('test- hlísti')).toEqual(['hlisti'])
    expect(topicTokens('prirodopis-6_pl-bezobratli-viry._test_2018')).toContain('viry')
  })
})

describe('sameTopic', () => {
  it('merges a shortened and a spelled-out name', () => {
    expect(sameTopic('Měkkýši', '6.22 Měkkýši (Mollusca) - PLŽI, MLŽI, HLAVONOŽCI 6.23')).toBe(true)
    expect(sameTopic('6.21 Hlísti', 'test- hlísti')).toBe(true)
    expect(sameTopic('Savci', '7.9 Savci')).toBe(true)
    expect(sameTopic('Poznávačka - ryby', '7.5 Ryby')).toBe(true)
  })

  it('does not merge different topics', () => {
    expect(sameTopic('Buňka', 'Buňky a tkáně')).toBe(false)
    expect(sameTopic('Dýchací soustava', 'Trávicí soustava')).toBe(false)
    expect(sameTopic('Vyvřelé magmatické horniny', 'Usazené sedimentární horniny')).toBe(false)
  })

  it('an adjective without a delimiter turns a general topic into a different subject', () => {
    // Real over-merge from the library: the topic "Rostliny" joined the general
    // introduction (7.11) with a separate lesson on spore plants (7.13) and with
    // materials on ferns/mosses, because all of them contain the word
    // "rostliny". They are four different lessons, though.
    expect(sameTopic('Rostliny', 'Výtrusné rostliny')).toBe(false)
    expect(sameTopic('Rostliny', 'vyšší rostliny - kapraďorosty')).toBe(false)
    expect(sameTopic('Rostliny', 'vyšší rostliny - ryniofyty a mechorosty')).toBe(false)
  })

  it('an addition separated by a dash/parenthesis/comma belongs to the same topic', () => {
    // Real names from the library: "Měkkýši" and its spelled-out version, "Viry"
    // and its worksheets — these SHOULD merge, because the extra words are
    // separated (apposition), not an attached attribute.
    expect(sameTopic('Měkkýši', '6.22 Měkkýši (Mollusca) - PLŽI, MLŽI, HLAVONOŽCI 6.23')).toBe(true)
    expect(sameTopic('Viry', 'viry-poznávačka')).toBe(true)
    expect(sameTopic('Viry', 'prirodopis-6_pl-bezobratli-viry_test_2018')).toBe(true)
  })

  it('a name without meaningful words merges nothing', () => {
    expect(sameTopic('test', 'Hlísti')).toBe(false)
  })
})

describe('findMatchingTopic', () => {
  const existing = [{ name: 'Oběhová soustava' }, { name: 'Dýchací soustava' }, { name: 'Trávicí soustava' }]

  it('finds the matching topic', () => {
    expect(findMatchingTopic(existing, 'Oběhová soustava- krevní oběh')?.name).toBe('Oběhová soustava')
    expect(findMatchingTopic(existing, '11. Dýchací soustava')?.name).toBe('Dýchací soustava')
  })

  it('returns null when nothing fits', () => {
    expect(findMatchingTopic(existing, 'Genetika')).toBeNull()
  })
})

describe('preferredTopicName', () => {
  it('the more concise name wins', () => {
    expect(preferredTopicName('Měkkýši', 'Měkkýši (Mollusca) - PLŽI, MLŽI')).toBe('Měkkýši')
  })
})

describe('a generic name does not join unrelated lessons', () => {
  const minerals = [
    { name: '2. mineralogická třída sulfidy' },
    { name: '3. mineralogická třída - halogenidy' },
    { name: '4. mineralogická třída - oxidy' },
  ]

  it('a name without a distinguishing word stays separate', () => {
    expect(findMatchingTopic(minerals, '6. mineralogická třída')).toBeNull()
  })

  it('a name with a distinguishing word joins its lesson', () => {
    expect(findMatchingTopic(minerals, 'mineralogická třída - oxidy zápis')?.name).toBe(
      '4. mineralogická třída - oxidy',
    )
  })

  it('several related files join into one group', () => {
    const viruses = [{ name: '6.11 Viry' }, { name: 'Viry' }]
    expect(findMatchingTopic(viruses, 'prirodopis-6_pl-bezobratli-viry test')?.name).toBeTruthy()
  })
})

describe('real library case: "Rostliny" (7. ročník)', () => {
  // This topic in the library used to join the general introduction (7.11)
  // with a separate lesson on spore plants (7.13) and with materials on
  // higher plants — four different lessons just because the name contains "rostliny".
  const existing = [{ name: 'Rostliny' }]

  it('a separate lesson on spore plants does not join the general introduction', () => {
    expect(findMatchingTopic(existing, '7.13 Výtrusné rostliny')).toBeNull()
  })

  it('a presentation export of the same lesson joins', () => {
    expect(findMatchingTopic(existing, '7.11 Rostliny prezentace')?.name).toBe('Rostliny')
  })
})

describe('groupForImport', () => {
  /** Shortcut: a placement as `parsePath` guesses it from the path. */
  function place(subject: string, grade: string | null, topic: string) {
    return { subject, grade, topic }
  }

  it('joins files of the same topic and keeps the clearer name for the group', () => {
    const groups = groupForImport([
      place('PŘÍRODOPIS', '6. ročník', '6.22 Měkkýši (Mollusca)'),
      place('PŘÍRODOPIS', '6. ročník', 'Měkkýši'),
      place('PŘÍRODOPIS', '6. ročník', 'Hlísti'),
    ])

    expect(groups).toHaveLength(2)
    const molluscs = groups.find((group) => group.topic === 'Měkkýši')
    expect(molluscs?.files).toHaveLength(2)
    expect(groups.find((group) => group.topic === 'Hlísti')?.files).toHaveLength(1)
  })

  it('the same topic in two grades stays two groups', () => {
    const groups = groupForImport([
      place('PŘÍRODOPIS', '7. ročník', 'Savci'),
      place('PŘÍRODOPIS', '8. ročník', 'Savci'),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.grade)).toEqual(['7. ročník', '8. ročník'])
  })

  it('a single file without a folder ends up unplaced, but with a topic name', () => {
    const groups = groupForImport([place('Nezařazeno', null, 'Opakování - zlomky')])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ subject: '', grade: '', topic: 'Opakování - zlomky' })
  })

  it('unplaced groups go first, the rest alphabetically', () => {
    const groups = groupForImport([
      place('ZEMĚPIS', '9. ročník', 'Afrika'),
      place('Nezařazeno', null, 'Pracovní list'),
      place('PŘÍRODOPIS', '6. ročník', 'Viry'),
    ])

    expect(groups.map((group) => group.subject)).toEqual(['', 'PŘÍRODOPIS', 'ZEMĚPIS'])
  })

  it('keeps extra data too, so the whole material can be sent from the preview', () => {
    const groups = groupForImport([
      { ...place('PŘÍRODOPIS', '6. ročník', 'Viry'), fileName: 'Viry.pdf', charCount: 4200 },
    ])

    expect(groups[0]?.files[0]?.fileName).toBe('Viry.pdf')
  })

  it('empty input gives an empty list of groups', () => {
    expect(groupForImport([])).toEqual([])
  })
})
