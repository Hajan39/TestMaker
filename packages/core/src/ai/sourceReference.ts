import type { QuestionContent } from '../schema/question'

/**
 * Phrases by which the model reveals that a question leans on the material
 * instead of standing on its own ("Kteří zástupci jsou uvedeni v materiálu?").
 * The pupil may not have the material at hand during the test at all, let
 * alone while it is being marked — a question must not refer to it.
 *
 * The text is checked without diacritics and case-insensitively, so that
 * "V materiálu" and "v materiálech" are caught by the same phrase. The
 * patterns are deliberately bound to the word after a preposition
 * (`v materiálu`, `podle textu`…), not to the bare noun — "stavební materiál"
 * or "Ze kterého materiálu se vyrábí sklo?" are ordinary questions about a
 * substance and do not reference a source.
 */
/**
 * Nouns that in this context mean *the test material*, not just any text.
 * Without this restriction "uveden… v" and "zmíněn… v" would also catch
 * "Který rok je uveden v Ústavě…" or "Jaké zvíře je zmíněno v básni Máj?" —
 * ordinary questions about the content of a work, not a reference to the
 * test material.
 */
const SOURCE_NOUN = '(material(u|ech)|text(u|ech)|clanku|ukazce|zdroji|prezentaci)'

const REFERENCE_PATTERNS: RegExp[] = [
  /\bve?\s+material(u|ech)\b/,
  /\bz\s+material(u|ech)\b/,
  /\bpodle\s+material(u|ech)\b/,
  /\bve?\s+textu\b/,
  /\bz\s+textu\b/,
  /\bpodle\s+textu\b/,
  /\bvychozim\s+textu\b/,
  /\bv\s+clanku\b/,
  /\bv\s+ukazce\b/,
  /\bve?\s+zdroji\b/,
  /\bv\s+prezentaci\b/,
  /\bv\s+tabulce\s+vyse\b/,
  /\bvyse\s+uveden\w*\b/,
  new RegExp(`\\buveden\\w*\\s+ve?\\s+${SOURCE_NOUN}\\b`),
  new RegExp(`\\bzmine\\w*\\s+ve?\\s+${SOURCE_NOUN}\\b`),
  /\bjak\s+je\s+uvedeno\b/,
  /\bviz\s+vyse\b/,
]

/**
 * "Na obrázku" references the material only when the question has no image
 * of its own — with its own image (`blocks`, `kind: 'image'`) it is an
 * ordinary prompt ("Co je znázorněno na obrázku?" for the image right below).
 */
const IMAGE_REFERENCE_PATTERN = /\bna\s+obrazku\b/

/** Without diacritics and upper case — so the patterns above need not handle them. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Does this text (prompt, option, statement…) refer to the material/text/source? */
function textReferencesSource(text: string, hasImageBlock: boolean): boolean {
  const normalized = normalize(text)
  if (REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized))) return true
  return !hasImageBlock && IMAGE_REFERENCE_PATTERN.test(normalized)
}

/** Text of a block (image, table) the pupil sees with the question. */
function blockTexts(question: QuestionContent): string[] {
  return question.blocks.flatMap((block) => {
    if (block.kind === 'image') return block.caption ? [block.caption] : []
    return [...(block.caption ? [block.caption] : []), ...block.rows.flatMap((row) => row.map((cell) => cell.text))]
  })
}

/**
 * All question text the pupil will see — prompt, options, statements, table
 * cells etc. Not `explanation` or `evidence` — only the teacher reads those
 * in the answer key; they are not printed for the pupil.
 */
function pupilVisibleTexts(question: QuestionContent): string[] {
  const texts: string[] = [question.payload.prompt, ...blockTexts(question)]
  switch (question.type) {
    case 'open':
    case 'draw':
    case 'short_answer':
      break
    case 'single_choice':
    case 'multi_choice':
      texts.push(...question.payload.options)
      break
    case 'true_false':
      texts.push(...question.payload.statements.map((s) => s.text))
      break
    case 'fill_blank':
      texts.push(question.payload.text, ...question.payload.wordBank)
      break
    case 'matching':
      texts.push(...question.payload.left, ...question.payload.right)
      break
    case 'ordering':
      texts.push(...question.payload.items)
      break
    case 'table_fill':
      texts.push(
        ...question.payload.headers,
        ...question.payload.rows.flatMap((row) => row.filter((cell): cell is string => cell !== null)),
      )
      break
    case 'label_image':
      texts.push(...question.payload.labels)
      break
  }
  return texts
}

/**
 * Does the question refer to the material/text/source instead of standing on
 * its own? Checks all text the pupil will see (`pupilVisibleTexts`) — a
 * single referencing part is enough (e.g. one true/false statement).
 */
export function referencesSource(question: QuestionContent): boolean {
  const hasImageBlock = question.blocks.some((block) => block.kind === 'image')
  return pupilVisibleTexts(question).some((text) => textReferencesSource(text, hasImageBlock))
}
