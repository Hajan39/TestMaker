import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/ai/generate'
import { buildSystemPrompt, buildUserPrompt } from '../src/ai/prompt'
import { readAiConfig, isAiConfigured } from '../src/ai/provider'
import { AI_QUESTION_TYPES, questionContentSchema } from '../src/schema/question'

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
})
