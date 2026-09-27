import { z } from 'zod'
import { normalizeMatchingPayload, normalizeOrderingPayload, questionContentSchema, type QuestionContent } from '../schema/question'
import { checkQuestion, duplicateCheck, withDefaultPoints } from './generate'
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
const RULES_HEADER = '# Pravidla školy:'

/**
 * Text tématu pro Claude Code: hlavička s ročníkem, existujícími otázkami
 * a pravidly školy, pak materiály. Pravidla se do stažitelného souboru
 * dostávají tudy, ne přes `buildQuestionRules` — ten skript je bez databáze
 * (`otazky:pravidla`), takže o škole neví nic; tenhle soubor ale škola
 * generuje, takže si aktivní pravidla dokáže dotáhnout sám.
 */
export function buildTopicSourceFile(meta: {
  subjectName: string
  gradeName: string | null
  topicName: string
  text: string
  existing: string[]
  schoolRules?: string[]
}): string {
  const lines = [
    `# Předmět: ${meta.subjectName}`,
    `# Ročník: ${meta.gradeName || 'neurčen'}`,
    `# Téma: ${meta.topicName}`,
  ]
  if (meta.schoolRules && meta.schoolRules.length > 0) {
    lines.push(RULES_HEADER, ...meta.schoolRules.map((rule) => `# - ${rule.replace(/\s+/g, ' ').trim()}`))
  }
  if (meta.existing.length > 0) {
    lines.push(EXISTING_HEADER, ...meta.existing.map((prompt) => `# - ${prompt.replace(/\s+/g, ' ').trim()}`))
  }
  lines.push('', meta.text)
  return lines.join('\n')
}

/** Pravidla školy z hlavičky staženého souboru — pro `/otazky` v Claude Code. */
export function schoolRulesFromSource(source: string): string[] {
  const lines = source.split('\n')
  const start = lines.indexOf(RULES_HEADER)
  if (start === -1) return []
  const rules: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('# - ')) break
    rules.push(line.slice(4))
  }
  return rules
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

/**
 * Materiály ze staženého souboru bez hlavičky `# …`. Při nahrání se citace
 * kontrolují proti samotným materiálům tématu, ne proti hlavičce — tady
 * musí být haystack tentýž, jinak by kontrola mimo aplikaci pustila citaci
 * z hlavičky, kterou pak nahrání odmítne. Soubor bez hlavičky se vrací celý.
 */
export function materialFromSource(source: string): string {
  const lines = source.split('\n')
  if (!lines[0]?.startsWith('# Předmět:')) return source
  let i = 0
  while (lines[i]?.startsWith('# ')) i++
  return lines.slice(lines[i] === '' ? i + 1 : i).join('\n')
}

/**
 * Pravidla pro psaní otázek: týž systémový prompt jako v aplikaci, typy a
 * přesný tvar (JSON Schema). Skript `otazky:pravidla` je bez databáze, takže
 * `schoolRules` odtud nedostane nikdy — pravidla školy do Claude Code chodí
 * hlavičkou staženého souboru (`buildTopicSourceFile`), tenhle parametr je
 * tu jen proto, aby volání s pravidly nezůstalo netestovatelné.
 */
export function buildQuestionRules(gradeName: string | null, schoolRules: string[] = []): string {
  const types = Object.entries(QUESTION_TYPE_HINTS)
    .filter(([type]) => type !== 'label_image')
    .map(([type, hint]) => `- ${type}: ${hint}`)
  return [
    buildSystemPrompt(gradeName, schoolRules),
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
 * Chyba v obsahu souboru s otázkami (nevalidní JSON, chybějící seznam
 * „questions"), ne v databázi ani jinde v aplikaci. Route handler podle týhle
 * třídy pozná, že jde o soubor, který má učitelka opravit v Claude Code, a
 * smí ji bezpečně ukázat jako hlášku uživateli — jiné výjimky (např. z
 * databáze) se takhle rozlišit nedají a nesmí se zaměnit za chybu souboru.
 */
export class QuestionFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuestionFileError'
  }
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
    throw new QuestionFileError('Soubor není platný JSON. Nech ho v Claude Code zapsat znovu příkazem /otazky.')
  }
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { questions?: unknown })?.questions)
      ? (raw as { questions: unknown[] }).questions
      : null
  if (!list) throw new QuestionFileError('V souboru chybí seznam otázek („questions").')

  const isDuplicate = duplicateCheck(existing)
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
    const question = withDefaultPoints(normalizeMatchingPayload(normalizeOrderingPayload(parsed.data)))
    if (isDuplicate(question)) {
      rejected.push({ index, errors: ['stejná otázka už v tématu nebo v souboru je'] })
      return
    }
    questions.push(question)
  })

  return { questions, rejected }
}
