/** Ověření celé cesty: vlastní otázky -> test -> PDF. */
import { writeFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, topics } from './src/db/index'

const BASE = 'http://localhost:3111'

async function post(path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const topicRows = await db.select({ id: topics.id, n: topics.name }).from(topics).limit(2)
  const [t1, t2] = topicRows
  if (!t1 || !t2) throw new Error('chybí témata')

  const questions = [
    {
      topicId: t1.id,
      question: {
        type: 'single_choice',
        payload: { prompt: 'Kde probíhá výměna plynů?', options: ['Průdušnice', 'Plicní sklípky', 'Hrtan'], correctIndex: 1 },
        points: 1,
        difficulty: 2,
        explanation: 'Sklípky jsou opředeny vlásečnicemi.',
      },
    },
    {
      topicId: t1.id,
      question: {
        type: 'open',
        payload: { prompt: 'Popiš cestu vzduchu do plic.', lines: 4, answer: 'Nos → hrtan → průdušnice → plíce' },
        points: 3,
        difficulty: 3,
      },
    },
    {
      topicId: t2.id,
      question: {
        type: 'table_fill',
        payload: {
          prompt: 'Doplň tabulku.',
          headers: ['Orgán', 'Funkce'],
          rows: [['Hrtan', null], [null, 'Výměna plynů']],
          answers: ['tvorba hlasu', 'plicní sklípky'],
        },
        points: 3,
        difficulty: 2,
      },
    },
    {
      topicId: t2.id,
      question: {
        type: 'matching',
        payload: {
          prompt: 'Přiřaď dvojice.',
          left: ['Hrtan', 'Průdušnice', 'Sklípky'],
          right: ['Výměna plynů', 'Hlas', 'Vedení vzduchu'],
          pairs: [[0, 1], [1, 2], [2, 0]],
        },
        points: 3,
        difficulty: 2,
      },
    },
  ]

  const ids: string[] = []
  for (const q of questions) ids.push((await post('/api/questions', q)).id)
  console.log('otázky vytvořeny:', ids.length)

  const templateRows = await import('./src/db/index').then((m) => m.db.select().from(m.templates))
  const templateId = templateRows[0]!.id

  const items = [
    { kind: 'heading', questionId: null, text: 'Část A – Dýchací soustava', pointsOverride: null },
    { kind: 'question', questionId: ids[0], text: null, pointsOverride: null },
    { kind: 'question', questionId: ids[1], text: null, pointsOverride: null },
    { kind: 'instruction', questionId: null, text: 'Odpovídej celými větami.', pointsOverride: null },
    { kind: 'heading', questionId: null, text: 'Část B – Opakování', pointsOverride: null },
    { kind: 'question', questionId: ids[2], text: null, pointsOverride: 2 },
    { kind: 'question', questionId: ids[3], text: null, pointsOverride: null },
  ]

  const created = await post('/api/tests', {
    title: 'Čtvrtletní písemka',
    description: 'Opakování napříč tématy.',
    graded: true,
    templateId,
    header: { school: 'ZŠ Ukázková', subject: 'Přírodopis', className: '', teacher: '', date: '', note: '' },
    variants: 2,
    showKey: true,
    items,
  })
  console.log('test vytvořen:', created.id)

  for (const variant of ['A', 'B']) {
    const response = await fetch(`${BASE}/api/tests/${created.id}/pdf?variant=${variant}&key=1`)
    if (!response.ok) throw new Error(`PDF ${variant}: ${response.status} ${await response.text()}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    writeFileSync(`/tmp/e2e-${variant}.pdf`, buffer)
    console.log(`PDF ${variant}: ${buffer.length} B, hlavička ${buffer.subarray(0, 5).toString()}`)
  }

  // Test bez známek
  await post('/api/tests', { id: created.id, title: 'Čtvrtletní písemka', description: null, graded: false, templateId, header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' }, variants: 2, showKey: true, items }, 'PUT')
  const plain = await fetch(`${BASE}/api/tests/${created.id}/pdf?variant=A&key=1`)
  writeFileSync('/tmp/e2e-bez-znamek.pdf', Buffer.from(await plain.arrayBuffer()))
  console.log('PDF bez známek: OK')
  console.log('testId=' + created.id)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
