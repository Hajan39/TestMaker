/**
 * Trial generation without a database: generates questions from a text file
 * with the model from AI_MODELS and writes them to Markdown for manual rating.
 * Used to compare models and generation changes — and to compare with /otazky.
 *
 *   pnpm --filter @testmaker/web generate:try <file.txt> "<grade>" "<subject>" "<topic>" [count]
 *
 * Download the file in the topic with the "Stáhnout materiály" button (or save
 * text with `=== name ===` headers). Use an absolute path: `pnpm --filter` runs
 * the script in apps/web, where a relative path would be resolved.
 *
 * The downloaded file's header (`# Předmět…`) is cut off the material, and the
 * questions listed there as existing are given to the model as the "avoid"
 * list — just like generation in the app.
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

function description(q: QuestionContent): string {
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
  const [file, grade, subject, topic, count] = process.argv.slice(2)
  if (!file || !grade || !subject || !topic) {
    console.error('Použití: generate:try <soubor.txt> "<ročník>" "<předmět>" "<téma>" [počet]')
    process.exit(1)
  }
  const ladder = readAiLadder()
  console.log(`žebříček: ${ladder.map(describeAiConfig).join(' → ') || '— (chybí klíč nebo AI_MODELS)'}`)
  const source = await readFile(file, 'utf8')
  const start = Date.now()
  const result = await generateQuestions(
    {
      text: materialFromSource(source),
      topicName: topic,
      subjectName: subject,
      gradeName: grade,
      count: Number(count) || 10,
      types: [...AI_QUESTION_TYPES],
      difficulty: 'mix',
      avoid: existingPromptsFromSource(source),
    },
    { models: ladder },
  )

  const rows = [
    `# Zkušební generování — ${topic} (${grade})`,
    '',
    `Model: ${result.models.join(', ') || '—'} · úseků: ${result.chunks} · za ${Math.round((Date.now() - start) / 1000)} s`,
    `Přijato: ${result.questions.length} · zahozeno: ${result.rejected.length} · neúspěšná volání: ${result.failedCalls.length}`,
    '',
    'U každé otázky zaškrtni, jestli by šla do písemky beze změny.',
    '',
    ...result.questions.flatMap((q, i) => [
      `## ${i + 1}. ${q.type} · obtížnost ${q.difficulty}`,
      '',
      '- [ ] dobrá beze změny',
      '',
      description(q),
      '',
      q.explanation ? `> Vysvětlení: ${q.explanation}` : '',
      q.evidence ? `> Citace (${q.evidence.fileName}): ${q.evidence.quote}` : '> Citace: —',
      '',
    ]),
    ...(result.rejected.length
      ? ['## Zahozené', '', ...result.rejected.map((r) => `- #${r.index}: ${r.errors.join('; ')}`)]
      : []),
  ]
  const output = `${file.replace(/\.[^.]+$/, '')}.otazky.md`
  await writeFile(output, rows.join('\n'))
  console.log(`Zapsáno: ${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
