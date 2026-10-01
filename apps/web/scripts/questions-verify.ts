/**
 * Checks a question file the same way the app checks it on upload. No
 * database — existing questions are taken from the source file's header.
 *
 *   pnpm --filter @testmaker/web otazky:over <zdroj.txt> <otazky.json>
 *
 * Use absolute paths: `pnpm --filter` runs the script in apps/web, so a
 * relative path would be resolved there. Quotes are checked only against
 * materials without the `# …` header — same as on upload in the app.
 */
import { readFileSync } from 'node:fs'
import { existingPromptsFromSource, materialFromSource, readQuestionFile } from '@testmaker/core/ai'

const [sourcePath, questionsPath] = process.argv.slice(2)
if (!sourcePath || !questionsPath) {
  console.error('Použití: otazky:over <zdroj.txt> <otazky.json>')
  process.exit(1)
}
const source = readFileSync(sourcePath, 'utf8')
try {
  const { questions, rejected } = readQuestionFile(
    readFileSync(questionsPath, 'utf8'),
    materialFromSource(source),
    existingPromptsFromSource(source),
  )
  console.log(`V pořádku: ${questions.length}, odmítnuto: ${rejected.length}`)
  for (const r of rejected) console.log(`- otázka #${r.index}: ${r.errors.join('; ')}`)
  process.exit(rejected.length > 0 ? 1 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
