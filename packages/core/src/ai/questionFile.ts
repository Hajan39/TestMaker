import { z } from 'zod'
import { normalizeOrderingPayload, questionContentSchema, type QuestionContent } from '../schema/question'
import { checkQuestion, dedupeKey, promptOf, withDefaultPoints } from './generate'
import { buildSystemPrompt, QUESTION_TYPE_HINTS } from './prompts/questions'

/**
 * Otázky z Claude Code. Předplatné Claude Max se v aplikaci použít nedá,
 * v Claude Code ano: majitel si stáhne materiály tématu jako text, příkazem
 * `/otazky` nechá napsat otázky a soubor nahraje zpátky do tématu. Kontrola je
 * tatáž jako u generování v aplikaci (`checkQuestion`), jen typy nejsou
 * omezené — Claude zvládne i přiřazování a řazení.
 */
export const CLAUDE_CODE_MODEL = 'claude-code'

const EXISTING_HEADER = '# Otázky, které už v tématu jsou — nepiš je znovu:'

/** Text tématu pro Claude Code: hlavička s ročníkem a existujícími otázkami, pak materiály. */
export function buildTopicSourceFile(meta: {
  subjectName: string
  gradeName: string | null
  topicName: string
  text: string
  existing: string[]
}): string {
  const lines = [
    `# Předmět: ${meta.subjectName}`,
    `# Ročník: ${meta.gradeName || 'neurčen'}`,
    `# Téma: ${meta.topicName}`,
  ]
  if (meta.existing.length > 0) {
    lines.push(EXISTING_HEADER, ...meta.existing.map((prompt) => `# - ${prompt.replace(/\s+/g, ' ').trim()}`))
  }
  lines.push('', meta.text)
  return lines.join('\n')
}

/** Existující otázky z hlavičky zdrojového souboru. */
export function existingPromptsFromSource(source: string): string[] {
  const lines = source.split('\n')
  const start = lines.indexOf(EXISTING_HEADER)
  if (start === -1) return []
  const prompts: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('# - ')) break
    prompts.push(line.slice(4))
  }
  return prompts
}

/** Pravidla pro psaní otázek: týž systémový prompt jako v aplikaci, typy a přesný tvar (JSON Schema). */
export function buildQuestionRules(gradeName: string | null): string {
  const types = Object.entries(QUESTION_TYPE_HINTS)
    .filter(([type]) => type !== 'label_image')
    .map(([type, hint]) => `- ${type}: ${hint}`)
  return [
    buildSystemPrompt(gradeName),
    '',
    'Typy otázek (label_image nepoužívej):',
    ...types,
    '',
    'Soubor je JSON ve tvaru { "questions": [ … ] }, každá otázka odpovídá tomuto schématu:',
    // `io: 'input'` — schéma `matching` obsahuje transform (`pairs`), a bez
    // téhle volby ho `toJSONSchema` odmítne stejně jako v `ai.test.ts`.
    JSON.stringify(z.toJSONSchema(questionContentSchema, { io: 'input' }), null, 2),
  ].join('\n')
}

/**
 * Přečte soubor s otázkami a nechá jen ty, které projdou kontrolou tvaru,
 * doslovné citace (vůči zdrojovému textu) a duplicit — v souboru i vůči
 * otázkám, které už v tématu jsou.
 */
export function readQuestionFile(
  json: string,
  source: string,
  existing: string[] = [],
): { questions: QuestionContent[]; rejected: { index: number; errors: string[] }[] } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Soubor není platný JSON. Nech ho v Claude Code zapsat znovu příkazem /otazky.')
  }
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { questions?: unknown })?.questions)
      ? (raw as { questions: unknown[] }).questions
      : null
  if (!list) throw new Error('V souboru chybí seznam otázek („questions").')

  const seen = new Set(existing.map(dedupeKey))
  const questions: QuestionContent[] = []
  const rejected: { index: number; errors: string[] }[] = []

  list.forEach((candidate, index) => {
    const parsed = questionContentSchema.safeParse(candidate)
    if (!parsed.success) {
      rejected.push({ index, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'otázka'}: ${i.message}`) })
      return
    }
    if (parsed.data.type === 'label_image') {
      rejected.push({ index, errors: ['popis obrázku se ze souboru nahrát nedá'] })
      return
    }
    const errors = checkQuestion(parsed.data, source)
    if (errors.length > 0) {
      rejected.push({ index, errors })
      return
    }
    const question = withDefaultPoints(normalizeOrderingPayload(parsed.data))
    const key = dedupeKey(promptOf(question))
    if (seen.has(key)) {
      rejected.push({ index, errors: ['stejná otázka už v tématu nebo v souboru je'] })
      return
    }
    seen.add(key)
    questions.push(question)
  })

  return { questions, rejected }
}
