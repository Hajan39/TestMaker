/**
 * Vypíše pravidla pro psaní otázek (týž prompt jako v aplikaci) a přesný
 * tvar souboru. Volá ho skill /otazky v Claude Code.
 *
 *   pnpm --filter @testmaker/web otazky:pravidla "<ročník>"
 */
import { buildQuestionRules } from '@testmaker/core/ai'

console.log(buildQuestionRules(process.argv[2] ?? null))
