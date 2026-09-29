/**
 * Zkušební generování bez databáze: z textového souboru vygeneruje otázky
 * modelem z AI_MODELS a zapíše je do Markdownu k ručnímu hodnocení.
 * Slouží ke srovnání modelů a změn generování — a k porovnání s /otazky.
 *
 *   pnpm --filter @testmaker/web generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]
 *
 * Soubor stáhni v tématu tlačítkem „Stáhnout materiály" (nebo ulož text se
 * záhlavím `=== název ===`). Cestu k souboru piš absolutní: `pnpm --filter`
 * spouští skript ve složce apps/web, relativní cesta by se hledala tam.
 *
 * Hlavička staženého souboru (`# Předmět…`) se z materiálu odřízne a otázky,
 * které v ní jsou vypsané jako existující, dostane model jako seznam
 * „vyhni se" — tak jako při generování v aplikaci.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { AI_QUESTION_TYPES, type QuestionContent } from '@testmaker/core/schema'
import {
  describeAiConfig,
  existingPromptsFromSource,
  generateQuestions,
  materialFromSource,
  readAiLadder,
} from '@testmaker/core/ai'
import { loadEnv } from './env'

function popis(q: QuestionContent): string {
  switch (q.type) {
    case 'single_choice':
      return [q.payload.prompt, ...q.payload.options.map((o, i) => `   ${i === q.payload.correctIndex ? '**✓**' : '·'} ${o}`)].join('\n')
    case 'true_false':
      return [q.payload.prompt, ...q.payload.statements.map((s) => `   ${s.isTrue ? 'P' : 'N'} — ${s.text}`)].join('\n')
    case 'short_answer':
      return `${q.payload.prompt}\n   Odpověď: **${q.payload.answer}**${
        q.payload.acceptedAnswers.length ? ` (také: ${q.payload.acceptedAnswers.join(', ')})` : ''
      }`
    case 'multi_choice':
      return [
        q.payload.prompt,
        ...q.payload.options.map(
          (o, i) => `   ${q.payload.correctIndices.includes(i) ? '**✓**' : '·'} ${o}`,
        ),
      ].join('\n')
    case 'open':
      return `${q.payload.prompt}\n   Vzorová odpověď: **${q.payload.answer}** (${q.payload.lines} ř.)`
    case 'draw':
      return `${q.payload.prompt}\n   Kresba má obsahovat: **${q.payload.answer}** (${q.payload.lines} ř.)`
    case 'matching':
      return [
        q.payload.prompt,
        ...q.payload.pairs.map(
          ([l, r]) => `   ${q.payload.left[l] ?? '?'} — ${q.payload.right[r] ?? '?'}`,
        ),
      ].join('\n')
    case 'ordering':
      return [q.payload.prompt, ...q.payload.items.map((item, i) => `   ${i + 1}. ${item}`)].join('\n')
    case 'fill_blank':
      return `${q.payload.prompt}\n   ${q.payload.text}\n   Doplnit: ${q.payload.blanks.join(', ')}`
    default:
      return `\`\`\`json\n${JSON.stringify(q.payload, null, 2)}\n\`\`\``
  }
}

async function main() {
  loadEnv()
  const [soubor, rocnik, predmet, tema, pocet] = process.argv.slice(2)
  if (!soubor || !rocnik || !predmet || !tema) {
    console.error('Použití: generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]')
    process.exit(1)
  }
  const ladder = readAiLadder()
  console.log(`žebříček: ${ladder.map(describeAiConfig).join(' → ') || '— (chybí klíč nebo AI_MODELS)'}`)
  const zdroj = await readFile(soubor, 'utf8')
  const start = Date.now()
  const vysledek = await generateQuestions(
    {
      text: materialFromSource(zdroj),
      topicName: tema,
      subjectName: predmet,
      gradeName: rocnik,
      count: Number(pocet) || 10,
      types: [...AI_QUESTION_TYPES],
      difficulty: 'mix',
      avoid: existingPromptsFromSource(zdroj),
    },
    { models: ladder },
  )

  const radky = [
    `# Zkušební generování — ${tema} (${rocnik})`,
    '',
    `Model: ${vysledek.models.join(', ') || '—'} · úseků: ${vysledek.chunks} · za ${Math.round((Date.now() - start) / 1000)} s`,
    `Přijato: ${vysledek.questions.length} · zahozeno: ${vysledek.rejected.length} · neúspěšná volání: ${vysledek.failedCalls.length}`,
    '',
    'U každé otázky zaškrtni, jestli by šla do písemky beze změny.',
    '',
    ...vysledek.questions.flatMap((q, i) => [
      `## ${i + 1}. ${q.type} · obtížnost ${q.difficulty}`,
      '',
      '- [ ] dobrá beze změny',
      '',
      popis(q),
      '',
      q.explanation ? `> Vysvětlení: ${q.explanation}` : '',
      q.evidence ? `> Citace (${q.evidence.fileName}): ${q.evidence.quote}` : '> Citace: —',
      '',
    ]),
    ...(vysledek.rejected.length
      ? ['## Zahozené', '', ...vysledek.rejected.map((r) => `- #${r.index}: ${r.errors.join('; ')}`)]
      : []),
  ]
  const vystup = `${soubor.replace(/\.[^.]+$/, '')}.otazky.md`
  await writeFile(vystup, radky.join('\n'))
  console.log(`Zapsáno: ${vystup}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
