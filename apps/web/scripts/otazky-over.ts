/**
 * Zkontroluje soubor s otázkami stejně, jako ho zkontroluje aplikace při
 * nahrání. Bez databáze — existující otázky bere z hlavičky zdrojového souboru.
 *
 *   pnpm --filter @testmaker/web otazky:over <zdroj.txt> <otazky.json>
 *
 * Cesty piš absolutní: `pnpm --filter` spouští skript ve složce apps/web,
 * relativní cesta by se hledala tam. Citace se kontrolují jen proti
 * materiálům bez hlavičky `# …` — stejně jako při nahrání v aplikaci.
 */
import { readFileSync } from 'node:fs'
import { existingPromptsFromSource, materialFromSource, readQuestionFile } from '@testmaker/core/ai'

const [zdrojCesta, otazkyCesta] = process.argv.slice(2)
if (!zdrojCesta || !otazkyCesta) {
  console.error('Použití: otazky:over <zdroj.txt> <otazky.json>')
  process.exit(1)
}
const zdroj = readFileSync(zdrojCesta, 'utf8')
try {
  const { questions, rejected } = readQuestionFile(
    readFileSync(otazkyCesta, 'utf8'),
    materialFromSource(zdroj),
    existingPromptsFromSource(zdroj),
  )
  console.log(`V pořádku: ${questions.length}, odmítnuto: ${rejected.length}`)
  for (const r of rejected) console.log(`- otázka #${r.index}: ${r.errors.join('; ')}`)
  process.exit(rejected.length > 0 ? 1 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
