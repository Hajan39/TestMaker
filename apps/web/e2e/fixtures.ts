import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Data, na kterých testy pracují, si testy zakládají samy — dřív tu byla
 * natvrdo id z autorova disku a na čerstvě naimportované databázi testy
 * spadly. Fixtura je idempotentní: co už existuje, znovu nevzniká, takže
 * opakované běhy knihovnu nezanášejí.
 */

// Název předmětu schválně nezačíná na „ZKOUŠKA“ — test mazání hledá předmět
// podle části názvu a druhá zkušební položka by mu ho rozdvojila.
const SUBJECT = 'E2E KONTROLA'
// Vlastní název ročníku: testy v podklady.spec.ts sahají po prvním odkazu
// „9. ročník“ a zkušební ročník by se jim pletl do cesty.
const GRADE = 'E2E ročník'
const TOPIC = 'Zkušební téma'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
const TEXT =
  'Fotosyntéza je děj, při kterém zelené rostliny z oxidu uhličitého a vody za přítomnosti světla vytvářejí cukry a kyslík. '.repeat(
    12,
  )

interface SearchResult {
  topicId: string
  topicName: string
}

/** Téma s materiálem i schválenými otázkami. Vrací cestu `/topics/<id>`. */
export async function testTopicPath(request: APIRequestContext): Promise<string> {
  const topicId = await ensureTopic(request)
  await ensureQuestions(request, topicId)
  return `/topics/${topicId}`
}

/** Třída (ročník), ve které zkušební téma leží. Vrací cestu `/tridy/<id>`. */
export async function testGradeQuery(request: APIRequestContext): Promise<string> {
  const topicId = await ensureTopic(request)
  const response = await request.get(`/api/topics?gradesOf=${encodeURIComponent(topicId)}`)
  expect(response.ok()).toBe(true)

  const { grades, currentGrade } = (await response.json()) as {
    grades: { id: string; name: string }[]
    currentGrade: string
  }
  const grade = grades.find((row) => row.name === currentGrade) ?? grades[0]
  expect(grade, 'zkušební ročník se nenašel').toBeTruthy()
  return `/tridy/${grade!.id}`
}

/** Importuje zkušební materiál (opakovaně tentýž) a vrátí id jeho tématu. */
async function ensureTopic(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${TOPIC}.txt`,
          fileName: `${TOPIC}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic: TOPIC,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          // Pevný otisk obsahu: při dalším běhu se materiál pozná jako už známý.
          contentHash: 'e2e-zkusebni-tema-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: SearchResult[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC)) ?? results[0]
  expect(topic, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

/**
 * Doplní otázky do počtu, se kterým se dá pracovat (hromadný výběr, filtry).
 * Každá má jinou obtížnost, aby filtr obtížnosti měl co vybírat.
 */
async function ensureQuestions(request: APIRequestContext, topicId: string): Promise<void> {
  const impact = await request.get(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(impact.ok()).toBe(true)
  const { questions } = (await impact.json()) as { questions: number }
  if (questions >= 3) return

  const prepared = [
    {
      type: 'single_choice' as const,
      difficulty: 1 as const,
      points: 1,
      blocks: [],
      payload: {
        prompt: 'Kde probíhá fotosyntéza?',
        options: ['V kořenech', 'V chloroplastech', 'V květu'],
        correctIndex: 1,
      },
    },
    {
      type: 'true_false' as const,
      difficulty: 2 as const,
      points: 2,
      blocks: [],
      payload: {
        prompt: 'Rozhodni, zda jsou tvrzení pravdivá.',
        statements: [
          { text: 'Fotosyntéza potřebuje světlo.', isTrue: true },
          { text: 'Fotosyntéza probíhá v noci stejně jako ve dne.', isTrue: false },
        ],
      },
    },
    {
      type: 'open' as const,
      difficulty: 3 as const,
      points: 3,
      blocks: [],
      payload: {
        prompt: 'Popiš vlastními slovy, co při fotosyntéze vzniká.',
        lines: 4,
        answer: 'Cukry a kyslík.',
      },
    },
  ]

  for (const question of prepared.slice(questions)) {
    const created = await request.post('/api/questions', { data: { topicId, question } })
    expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  }
}
