import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Tests create the data they work on themselves — ids from the author's disk
 * used to be hard-coded here and tests failed on a freshly imported database.
 * The fixture is idempotent: what exists is not created again, so repeated
 * runs do not clutter the library.
 */

// The subject name deliberately does not start with "ZKOUŠKA" — the deletion
// test looks the subject up by part of its name and a second test item would split it.
const SUBJECT = 'E2E KONTROLA'
// Own grade name: tests in thin-topics.spec.ts grab the first "9. ročník"
// link and a test grade would get in their way.
const GRADE = 'E2E ročník'
const TOPIC = 'Zkušební téma'

/** The material text must be long enough for the topic not to be flagged as "low content". */
const TEXT =
  'Fotosyntéza je děj, při kterém zelené rostliny z oxidu uhličitého a vody za přítomnosti světla vytvářejí cukry a kyslík. '.repeat(
    12,
  )

interface SearchResult {
  topicId: string
  topicName: string
}

/** A topic with a material and approved questions. Returns the `/topics/<id>` path. */
export async function testTopicPath(request: APIRequestContext): Promise<string> {
  const topicId = await ensureTopic(request)
  await ensureQuestions(request, topicId)
  return `/topics/${topicId}`
}

/** The class (grade) the test topic lives in. Returns the `/tridy/<id>` path. */
export async function testGradeQuery(request: APIRequestContext): Promise<string> {
  const topicId = await ensureTopic(request)
  const response = await request.get(`/api/topics?gradesOf=${encodeURIComponent(topicId)}`)
  expect(response.ok()).toBe(true)

  const { grades, currentGrade } = (await response.json()) as {
    grades: { id: string; name: string }[]
    currentGrade: string
  }
  const grade = grades.find((row) => row.name === currentGrade) ?? grades[0]
  expect(grade, 'test grade not found').toBeTruthy()
  return `/tridy/${grade!.id}`
}

/** Imports the test material (the same one every time) and returns its topic id. */
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
          // Fixed content hash: on the next run the material is recognised as known.
          contentHash: 'e2e-zkusebni-tema-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: SearchResult[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC)) ?? results[0]
  expect(topic, `test topic "${TOPIC}" not found in the library`).toBeTruthy()
  return topic!.topicId
}

/**
 * Tops up questions to a workable count (bulk selection, filters). Each has a
 * different difficulty so the difficulty filter has something to pick.
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
    expect(created.ok(), 'failed to create the test question').toBe(true)
  }
}
