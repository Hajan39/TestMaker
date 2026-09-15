import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/ai/generate'
import { buildSystemPrompt, buildUserPrompt } from '../src/ai/prompt'
import { readAiConfig, isAiConfigured } from '../src/ai/provider'
import { AI_QUESTION_TYPES, normalizeEvidence, questionContentSchema } from '../src/schema/question'

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

  it('Ollama nepotřebuje klíč', () => {
    expect(readAiConfig({ AI_PROVIDER: 'ollama' }).model).toBe('qwen3:14b')
    expect(isAiConfigured({ AI_PROVIDER: 'ollama' })).toBe(true)
  })
})
