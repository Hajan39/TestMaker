/**
 * Prints the rules for writing questions (the same prompt as in the app) and
 * the exact file format. Called by the /otazky skill in Claude Code.
 *
 *   pnpm --filter @testmaker/web otazky:pravidla "<ročník>"
 */
import { buildQuestionRules } from '@testmaker/core/ai'

console.log(buildQuestionRules(process.argv[2] ?? null))
