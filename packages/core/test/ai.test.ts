import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { chunkText, distributeTypes, promptOf, salvageQuestions, splitIntoBatches } from '../src/ai/generate'
import { buildSystemPrompt, buildUserPrompt } from '../src/ai/prompt'
import { readAiConfig, isAiConfigured } from '../src/ai/provider'
import {
  AI_QUESTION_TYPES,
  normalizeEvidence,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
} from '../src/schema/question'

describe('schéma pro model', () => {
  it('jde převést na JSON Schema (structured output)', () => {
    const schema = z.object({ questions: z.array(questionContentSchema).min(1) })
    const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
    expect(jsonSchema.type).toBe('object')
    expect(JSON.stringify(jsonSchema)).toContain('single_choice')
  })

  it('přijme otázku od modelu a doplní výchozí hodnoty', () => {
    const parsed = questionContentSchema.parse({
      type: 'single_choice',
      payload: { prompt: 'Otázka?', options: ['a', 'b'], correctIndex: 1 },
    })
    expect(parsed.points).toBe(1)
    expect(parsed.difficulty).toBe(2)
    expect(parsed.blocks).toEqual([])
  })
})

describe('prompty', () => {
  it('obsahují materiál, ročník i požadované typy', () => {
    const prompt = buildUserPrompt({
      text: 'Plicní sklípky zajišťují výměnu plynů.',
      topicName: 'Dýchací soustava',
      subjectName: 'Přírodopis',
      gradeName: '8. ročník',
      count: 5,
      types: ['single_choice', 'open'],
      difficulty: 'mix',
      avoid: ['Co je hrtan?'],
    })
    expect(prompt).toContain('8. ročník')
    expect(prompt).toContain('Plicní sklípky')
    expect(prompt).toContain('single_choice')
    expect(prompt).toContain('Co je hrtan?')
    expect(prompt).toContain('promíchej')
    expect(buildSystemPrompt()).toContain('výhradně z dodaného materiálu')
  })

  it('pokryje všechny typy, které smí AI generovat', () => {
    const prompt = buildUserPrompt({
      text: 'x',
      topicName: 't',
      subjectName: 's',
      gradeName: null,
      count: 1,
      types: [...AI_QUESTION_TYPES],
      difficulty: 2,
    })
    for (const type of AI_QUESTION_TYPES) expect(prompt, type).toContain(type)
  })
})

describe('dělení dlouhých materiálů', () => {
  it('nedělí krátký text', () => {
    expect(chunkText('krátký text')).toHaveLength(1)
  })

  it('dělí na hranicích odstavců', () => {
    const paragraph = `${'a'.repeat(400)}\n\n`
    const chunks = chunkText(paragraph.repeat(10), 1000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('').replace(/\s/g, '')).toBe(paragraph.repeat(10).replace(/\s/g, ''))
  })
})

describe('doklad původu otázky', () => {
  it('schéma přijme název souboru a citaci', () => {
    const parsed = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Kolik laloků má pravá plíce?', answer: 'tři' },
      evidence: { fileName: 'Dýchací soustava.odp', quote: 'Pravá plíce má tři laloky.' },
    })
    expect(parsed.evidence?.quote).toContain('tři laloky')
  })

  it('doklad je nepovinný', () => {
    const parsed = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Otázka?', answer: 'odpověď' },
    })
    expect(parsed.evidence).toBeUndefined()
  })

  it('schéma nekontroluje délku citace — moc krátká ani moc dlouhá dávku nesestřelí', () => {
    const shortQuote = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Otázka?', answer: 'odpověď' },
      evidence: { fileName: 'a.pdf', quote: 'ok' },
    })
    expect(shortQuote.evidence?.quote).toBe('ok')

    const longQuote = 'x'.repeat(2000)
    const longQuoteParsed = questionContentSchema.parse({
      type: 'short_answer',
      payload: { prompt: 'Otázka?', answer: 'odpověď' },
      evidence: { fileName: 'a.pdf', quote: longQuote },
    })
    expect(longQuoteParsed.evidence?.quote).toHaveLength(2000)
  })

  it('prompt si o doklad řekne', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('evidence')
  })
})

describe('normalizace dokladu při ukládání', () => {
  it('chybějící doklad zůstane chybějící', () => {
    expect(normalizeEvidence(undefined)).toBeNull()
  })

  it('prázdnou nebo jen z bílých znaků citaci bere jako chybějící doklad', () => {
    expect(normalizeEvidence({ fileName: 'a.pdf', quote: '' })).toBeNull()
    expect(normalizeEvidence({ fileName: 'a.pdf', quote: '   ' })).toBeNull()
  })

  it('krátkou citaci uloží beze změny', () => {
    expect(normalizeEvidence({ fileName: 'a.pdf', quote: '  ok  ' })).toEqual({
      fileName: 'a.pdf',
      quote: 'ok',
    })
  })

  it('moc dlouhou citaci ořízne', () => {
    const quote = 'a'.repeat(500)
    const result = normalizeEvidence({ fileName: 'a.pdf', quote })
    expect(result?.quote.length).toBeLessThanOrEqual(401)
    expect(result?.quote.endsWith('…')).toBe(true)
    expect(result?.quote.startsWith('a'.repeat(400))).toBe(true)
  })
})

describe('konfigurace providera', () => {
  it('výchozí je Anthropic a bez klíče je generování vypnuté', () => {
    expect(readAiConfig({}).provider).toBe('anthropic')
    expect(readAiConfig({}).model).toBe('claude-opus-5')
    expect(isAiConfigured({})).toBe(false)
    expect(isAiConfigured({ ANTHROPIC_API_KEY: 'sk-test' })).toBe(true)
  })

  it('OAuth token z `ant auth login` nahrazuje klíč', () => {
    expect(isAiConfigured({ ANTHROPIC_AUTH_TOKEN: 'oauth-token' })).toBe(true)
  })

  it('Ollama nepotřebuje klíč', () => {
    expect(readAiConfig({ AI_PROVIDER: 'ollama' }).model).toBe('qwen3:14b')
    expect(isAiConfigured({ AI_PROVIDER: 'ollama' })).toBe(true)
  })

  it('bez AI_PROVIDER se pozná Google podle jeho klíče', () => {
    const env = { GOOGLE_GENERATIVE_AI_API_KEY: 'gk-test' }
    expect(readAiConfig(env).provider).toBe('google')
    expect(readAiConfig(env).model).toBe('gemini-flash-latest')
    expect(isAiConfigured(env)).toBe(true)
  })

  it('bez jakéhokoli klíče zůstává výchozí Anthropic, ale je nakonfigurovaný jako false', () => {
    expect(readAiConfig({}).provider).toBe('anthropic')
    expect(isAiConfigured({})).toBe(false)
  })

  it('má-li prostředí klíče pro víc poskytovatelů, bez AI_PROVIDER vyhraje Anthropic', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-test', GOOGLE_GENERATIVE_AI_API_KEY: 'gk-test' }
    expect(readAiConfig(env).provider).toBe('anthropic')
  })

  it('AI_PROVIDER přebije automatickou volbu podle klíčů', () => {
    const env = { AI_PROVIDER: 'google', ANTHROPIC_API_KEY: 'sk-test', GOOGLE_GENERATIVE_AI_API_KEY: 'gk-test' }
    expect(readAiConfig(env).provider).toBe('google')
  })

  it('Google bez klíče v prostředí není nakonfigurovaný, i když je vybraný výslovně', () => {
    expect(isAiConfigured({ AI_PROVIDER: 'google' })).toBe(false)
  })

  it('AI_MODEL přebije výchozí model i u Google', () => {
    expect(readAiConfig({ AI_PROVIDER: 'google', AI_MODEL: 'gemini-2.5-flash' }).model).toBe('gemini-2.5-flash')
  })
})

describe('dělení na dávky', () => {
  it('rozdělí požadovaný počet na volání po pěti', () => {
    expect(splitIntoBatches(12)).toEqual([5, 5, 2])
    expect(splitIntoBatches(5)).toEqual([5])
    expect(splitIntoBatches(1)).toEqual([1])
  })

  it('součet dávek se rovná zadanému počtu', () => {
    for (const count of [1, 3, 7, 12, 40]) {
      expect(splitIntoBatches(count).reduce((a, b) => a + b, 0)).toBe(count)
    }
  })
})

describe('záchrana nepovedené odpovědi', () => {
  const dobra = {
    type: 'short_answer',
    payload: { prompt: 'Kolik laloků má pravá plíce?', answer: 'tři' },
  }
  const spatna = {
    type: 'matching',
    payload: { prompt: 'Přiřaď.', left: ['a'], right: ['b'], pairs: 'tohle mělo být pole' },
  }

  it('z dávky s jednou vadnou otázkou zachrání ostatní', () => {
    const zachraneno = salvageQuestions({ questions: [dobra, spatna, dobra] })
    expect(zachraneno).toHaveLength(2)
    expect(zachraneno[0]?.type).toBe('short_answer')
  })

  it('zvládne i holé pole místo objektu', () => {
    expect(salvageQuestions([dobra])).toHaveLength(1)
  })

  it('z odpovědi bez použitelné otázky nevrátí nic', () => {
    expect(salvageQuestions({ questions: [spatna] })).toEqual([])
    expect(salvageQuestions({ neco: 'jineho' })).toEqual([])
    expect(salvageQuestions(null)).toEqual([])
  })
})

describe('seznam otázek k vyhnutí se v promptu', () => {
  it('nezahodí čerstvé otázky z běžícího generování ani u tématu s dlouhou historií', () => {
    // Simuluje stav z hlášení: téma už má 40 starých otázek, generuje se dál
    // a nově vzniklé (jdou první) se musí do promptu vejít celé.
    const stare = Array.from({ length: 40 }, (_, i) => `Stará otázka ${i}`)
    const nove = Array.from({ length: 5 }, (_, i) => `Nová otázka ${i}`)
    const prompt = buildUserPrompt({
      text: 'materiál',
      topicName: 't',
      subjectName: 's',
      gradeName: null,
      count: 5,
      types: ['open'],
      difficulty: 2,
      avoid: [...nove, ...stare],
    })
    for (const q of nove) expect(prompt, q).toContain(q)
  })

  it('ořízne jednotlivé položky, ne aby v seznamu chybělo celé zadání', () => {
    const dlouha = 'x'.repeat(500)
    const prompt = buildUserPrompt({
      text: 'materiál',
      topicName: 't',
      subjectName: 's',
      gradeName: null,
      count: 1,
      types: ['open'],
      difficulty: 2,
      avoid: [dlouha],
    })
    expect(prompt).not.toContain(dlouha)
    expect(prompt).toContain('x'.repeat(50))
  })
})

describe('rozpoznání duplicit u obecně formulovaných typů', () => {
  it('true_false bere do otisku znění tvrzení, ne obecný prompt', () => {
    const a: QuestionContent = {
      type: 'true_false',
      payload: { prompt: 'Rozhodni, zda jsou tvrzení pravdivá.', statements: [{ text: 'Slunce je hvězda.', isTrue: true }] },
      points: 1,
      difficulty: 2,
      blocks: [],
    }
    const b: QuestionContent = {
      type: 'true_false',
      payload: { prompt: 'Rozhodni, zda jsou tvrzení pravdivá.', statements: [{ text: 'Měsíc je planeta.', isTrue: false }] },
      points: 1,
      difficulty: 2,
      blocks: [],
    }
    expect(promptOf(a)).not.toBe(promptOf(b))
    expect(promptOf(a)).toContain('Slunce je hvězda')
  })

  it('fill_blank bere do otisku doplňovaná slova', () => {
    const q: QuestionContent = {
      type: 'fill_blank',
      payload: { prompt: 'Doplň chybějící výrazy.', text: 'Voda vře při ___ °C.', blanks: ['100'], wordBank: [] },
      points: 1,
      difficulty: 2,
      blocks: [],
    }
    expect(promptOf(q)).toContain('100')
  })

  it('matching bere do otisku dvojice, ne obecný prompt', () => {
    const q: QuestionContent = {
      type: 'matching',
      payload: {
        prompt: 'Přiřaď k sobě odpovídající dvojice.',
        left: ['Praha'],
        right: ['hlavní město'],
        pairs: [[0, 0]],
      },
      points: 1,
      difficulty: 2,
      blocks: [],
    }
    expect(promptOf(q)).toContain('Praha')
    expect(promptOf(q)).toContain('hlavní město')
  })
})

describe('řazení: oddělení správného pořadí od zadaného', () => {
  it('bez correctOrder projde jako dřív (items = správné pořadí)', () => {
    const parsed = questionContentSchema.parse({
      type: 'ordering',
      payload: { prompt: 'Seřaď.', items: ['a', 'b', 'c'] },
    })
    expect(validateQuestionContent(parsed)).toEqual([])
    expect(normalizeOrderingPayload(parsed)).toEqual(parsed)
  })

  it('platnou permutaci v correctOrder přijme a normalizace podle ní items přeuspořádá', () => {
    const parsed = questionContentSchema.parse({
      type: 'ordering',
      payload: { prompt: 'Seřaď.', items: ['třetí', 'první', 'druhý'], correctOrder: [1, 2, 0] },
    })
    expect(validateQuestionContent(parsed)).toEqual([])
    const normalized = normalizeOrderingPayload(parsed)
    expect(normalized.type).toBe('ordering')
    if (normalized.type === 'ordering') {
      expect(normalized.payload.items).toEqual(['první', 'druhý', 'třetí'])
      expect(normalized.payload).not.toHaveProperty('correctOrder')
    }
  })

  it('correctOrder, který není platnou permutací, validace odmítne', () => {
    const parsed = questionContentSchema.parse({
      type: 'ordering',
      payload: { prompt: 'Seřaď.', items: ['a', 'b', 'c'], correctOrder: [0, 0, 2] },
    })
    expect(validateQuestionContent(parsed).length).toBeGreaterThan(0)
  })

  it('correctOrder s indexem mimo rozsah items validace odmítne', () => {
    const parsed = questionContentSchema.parse({
      type: 'ordering',
      payload: { prompt: 'Seřaď.', items: ['a', 'b', 'c'], correctOrder: [0, 1, 5] },
    })
    expect(validateQuestionContent(parsed).length).toBeGreaterThan(0)
  })
})

describe('rozdělení typů mezi dávky', () => {
  it('rozdělí otázky mezi typy po kolečku', () => {
    expect(distributeTypes(['a', 'b', 'c'] as never, 7)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a'])
  })

  it('u dvanácti otázek a devíti typů nežádá nemožnou rovnost, ale rozumný rozvrh', () => {
    const types = [...AI_QUESTION_TYPES]
    const schedule = distributeTypes(types, 12)
    expect(schedule).toHaveLength(12)
    const counts = new Map<string, number>()
    for (const t of schedule) counts.set(t, (counts.get(t) ?? 0) + 1)
    // Rovnoměrně: nikdo nedostane o víc než 1 víc než jiný.
    const values = [...counts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('prompt pro jednu dávku žádá konkrétní počet u každého typu, ne obecně "rovnoměrně"', () => {
    const prompt = buildUserPrompt({
      text: 'x',
      topicName: 't',
      subjectName: 's',
      gradeName: null,
      count: 5,
      types: ['single_choice', 'single_choice', 'open'],
      difficulty: 2,
    })
    expect(prompt).toContain('single_choice')
    expect(prompt).toContain('× 2')
  })
})

describe('výběr více možností vyžaduje víc než jednu správnou odpověď', () => {
  it('jedna správná možnost je odmítnuta', () => {
    const parsed = questionContentSchema.parse({
      type: 'multi_choice',
      payload: { prompt: 'Vyber správné možnosti.', options: ['a', 'b', 'c', 'd'], correctIndices: [1] },
    })
    expect(validateQuestionContent(parsed)).toContain(
      'multi_choice musí mít aspoň dvě správné možnosti (jinak jde o single_choice)',
    )
  })

  it('dvě a víc správných možností v pořádku projde', () => {
    const parsed = questionContentSchema.parse({
      type: 'multi_choice',
      payload: { prompt: 'Vyber správné možnosti.', options: ['a', 'b', 'c', 'd'], correctIndices: [1, 2] },
    })
    expect(validateQuestionContent(parsed)).toEqual([])
  })
})

describe('přiřazování nesmí použít stejnou položku napravo dvakrát', () => {
  it('opakovaný pravý index je odmítnut', () => {
    const parsed = questionContentSchema.parse({
      type: 'matching',
      payload: {
        prompt: 'Přiřaď.',
        left: ['a', 'b'],
        right: ['x', 'y'],
        pairs: [
          [0, 0],
          [1, 0],
        ],
      },
    })
    expect(validateQuestionContent(parsed)).toContain('pravý sloupec se v pairs opakuje')
  })

  it('různé páry na obou stranách projdou bez chyby', () => {
    const parsed = questionContentSchema.parse({
      type: 'matching',
      payload: {
        prompt: 'Přiřaď.',
        left: ['a', 'b'],
        right: ['x', 'y'],
        pairs: [
          [0, 0],
          [1, 1],
        ],
      },
    })
    expect(validateQuestionContent(parsed)).toEqual([])
  })
})
