/**
 * Builds the database for browser tests (Playwright) from scratch.
 *
 *   pnpm --filter @testmaker/web e2e:db            # rebuilds (deletes the old one)
 *   pnpm --filter @testmaker/web e2e:db --if-missing  # builds only when missing
 *
 * Tests must not touch the live `local.db` — an earlier run deleted real
 * subjects from it. So they have their own `e2e.db` file, disposable at any
 * time: the content is entirely made up, nothing is copied from the owner's
 * library.
 *
 * The data matches what the tests in `e2e/**` expect:
 *   - a topic with "fotosyntéza" in its name under the PŘÍRODOPIS subject (library search),
 *   - the topic "Měkkýši" with a material named with "Mollusca" (search by file),
 *   - the grade "6. ročník" with enough topics to scroll and a long name without spaces,
 *   - topics with approved questions of all types and difficulties (bank, test outline),
 *   - a topic with the fixed id `csxxOerbvKhz` (the question freeze test hard-codes it),
 *   - built-in templates `builtin-*` (template previews, test printing),
 *   - a finished worksheet with the fixed id `e2e-pracovni-list` (worksheet overview, "ověř" flag).
 */
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { nanoid } from 'nanoid'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import * as schema from '../src/db/schema'
import { seedTemplates } from '../src/db/templates'
import { hashPassword } from '../src/lib/password'
import { DEFAULT_ACCOUNT_ID } from '../src/lib/defaultAccount'
import { MIN_USABLE_TOPIC_CHARS } from '../src/db/schema'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbFile = resolve(webRoot, process.env.E2E_DATABASE_FILE ?? 'e2e.db')
const onlyIfMissing = process.argv.includes('--if-missing')

const newId = () => nanoid(12)

/** A paragraph about the given topic, long enough for the topic not to be "thin". */
function text(topic: string, sentence: string): string {
  const body = `${sentence} `.repeat(8)
  return `${topic}\n\n${body}\nPoznámky k opakování: ${body}`
}

interface SeedQuestion {
  type: 'single_choice' | 'multi_choice' | 'true_false' | 'short_answer' | 'open' | 'matching'
  difficulty: 1 | 2 | 3
  points: number
  payload: Record<string, unknown>
}

/** A set of questions of all common types and difficulties for one topic. */
function questionSet(topic: string): SeedQuestion[] {
  return [
    {
      type: 'single_choice',
      difficulty: 1,
      points: 1,
      payload: {
        prompt: `${topic}: která odpověď je správná?`,
        options: ['První možnost', 'Druhá možnost', 'Třetí možnost'],
        correctIndex: 1,
      },
    },
    {
      type: 'true_false',
      difficulty: 2,
      points: 2,
      payload: {
        prompt: `${topic}: rozhodni, zda jsou tvrzení pravdivá.`,
        statements: [
          { text: 'První tvrzení je pravdivé.', isTrue: true },
          { text: 'Druhé tvrzení je nepravdivé.', isTrue: false },
        ],
      },
    },
    {
      type: 'open',
      difficulty: 3,
      points: 3,
      payload: {
        prompt: `${topic}: vysvětli vlastními slovy, o co jde.`,
        lines: 4,
        answer: 'Odpověď vlastními slovy.',
      },
    },
    {
      type: 'short_answer',
      difficulty: 1,
      points: 1,
      payload: { prompt: `${topic}: doplň chybějící pojem.`, answer: 'pojem', acceptedAnswers: [] },
    },
  ]
}

interface SeedTopic {
  /** A fixed id is set only where some test hard-codes it. */
  id?: string
  name: string
  /** Material file name; when missing, derived from the topic name. */
  fileName?: string
  sentence: string
  /** The topic gets a question set (question bank, test outline). */
  withQuestions?: boolean
}

interface SeedGrade {
  name: string
  topics: SeedTopic[]
}

interface SeedSubject {
  name: string
  grades: SeedGrade[]
}

/**
 * Filler topics so the grade has something to scroll (the scrolling test
 * expects content taller than the window) and tiles have room to wrap.
 */
const fillerNames = [
  'Buňka a její části',
  'Houby a lišejníky',
  'Jednobuněční',
  'Kořen, stonek, list',
  'Kroužkovci',
  'Členovci',
  'Obojživelníci',
  'Plazi',
  'Ptáci',
  'Savci',
  'Ryby',
  'Semena a plody',
  'Společenstva lesa',
  'Vodní ekosystémy',
  'Pavoukovci',
  'Korýši',
  'Hmyz s proměnou dokonalou',
  'Hmyz s proměnou nedokonalou',
  'Ploštěnci',
  'Hlísti',
  'Ostnokožci',
  'Bezobratlí v lese',
  'Mechorosty',
  'Kapraďorosty',
  'Řasy',
  'Sinice',
  'Bakterie',
  'Viry',
  'Půda a její obyvatelé',
  'Potravní řetězce',
  'Ochrana přírody',
  'Zoologická zahrada',
  'Pozorování lupou a mikroskopem',
  'Rostliny na louce',
  'Rostliny u vody',
  'Léčivé rostliny',
  'Jedovaté rostliny',
  'Stromy a keře',
  'Roční období v přírodě',
  'Opakování — bezobratlí',
  'Opakování — rostliny',
]

const fillerTopics: SeedTopic[] = fillerNames.map((name) => ({
  name,
  sentence: `${name} patří k učivu přírodopisu a probírá se v šestém ročníku.`,
}))

const SUBJECTS: SeedSubject[] = [
  {
    name: 'PŘÍRODOPIS',
    grades: [
      {
        name: '6. ročník',
        topics: [
          {
            name: 'Fotosyntéza a dýchání rostlin',
            sentence:
              'Fotosyntéza je děj, při kterém zelené rostliny z oxidu uhličitého a vody za přítomnosti světla vytvářejí cukry a kyslík.',
            withQuestions: true,
          },
          {
            name: 'Měkkýši',
            // The match hits the file name, not the topic name — searching for
            // "Mollusca" then shows it found the file.
            fileName: '6.22 Měkkýši (Mollusca) — zápis do sešitu.txt',
            sentence: 'Měkkýši mají měkké tělo, často chráněné schránkou, a patří mezi bezobratlé.',
            withQuestions: true,
          },
          {
            // A long name without spaces: exactly this shows whether the tile
            // can wrap or the text sticks out.
            name: 'prirodopis-6_pl-bezobratli-vztahy._test_2018',
            sentence: 'Pracovní list na vztahy mezi bezobratlými živočichy k opakování před písemkou.',
            withQuestions: true,
          },
          ...fillerTopics,
        ],
      },
      {
        name: '7. ročník',
        topics: [
          {
            name: 'Nahosemenné rostliny',
            sentence: 'Nahosemenné rostliny mají semena uložená volně na plodolistech, ne v plodu.',
          },
          {
            name: 'Krytosemenné rostliny',
            sentence: 'Krytosemenné rostliny mají semena ukrytá v plodu, který vzniká z pestíku.',
          },
        ],
      },
      {
        name: '8. ročník',
        topics: [
          {
            // The question freeze test has this id hard-coded.
            id: 'csxxOerbvKhz',
            name: 'Dýchací soustava',
            sentence:
              'Dýchací soustava přivádí do těla kyslík a odvádí oxid uhličitý; pravá plíce má tři laloky, levá dva.',
            withQuestions: true,
          },
          {
            name: 'Oběhová soustava',
            sentence: 'Oběhová soustava rozvádí krev po těle a srdce v ní pracuje jako pumpa.',
          },
        ],
      },
    ],
  },
  {
    name: 'ZEMĚPIS',
    grades: [
      {
        name: '6. ročník',
        topics: [
          {
            name: 'Podnebné pásy',
            sentence: 'Podnebné pásy se liší množstvím srážek a průměrnou teplotou během roku.',
          },
          {
            name: 'Mapa a měřítko',
            sentence: 'Měřítko mapy říká, kolikrát je skutečnost zmenšená oproti zákresu na mapě.',
            withQuestions: true,
          },
        ],
      },
    ],
  },
]

/** The school all test data belongs to. */
const SCHOOL_ID = 'skola-vyvoj'

/**
 * Accounts for tests. The passwords match `playwright.login.config.ts`; the
 * test database is disposable, so there is nothing secret here.
 */
export const E2E_PASSWORD = 'e2e-tajne-heslo'
const ACCOUNTS = [
  {
    id: DEFAULT_ACCOUNT_ID,
    email: 'spravce@localhost',
    name: 'Vývojový správce',
    role: 'spravce' as const,
    password: E2E_PASSWORD,
  },
  {
    id: 'e2e-ucitelka-a',
    email: 'ucitelka.a@localhost',
    name: 'Učitelka A',
    role: 'ucitelka' as const,
    password: E2E_PASSWORD,
  },
  {
    id: 'e2e-ucitelka-b',
    email: 'ucitelka.b@localhost',
    name: 'Učitelka B',
    role: 'ucitelka' as const,
    password: E2E_PASSWORD,
  },
  {
    id: 'e2e-nahled',
    email: 'nahled@localhost',
    name: 'Náhled',
    role: 'nahled' as const,
    password: E2E_PASSWORD,
  },
  {
    id: 'e2e-administrator',
    email: 'admin@localhost',
    name: 'Administrátor',
    role: 'administrator' as const,
    password: E2E_PASSWORD,
  },
]

/**
 * A second school for administrator tests: its own manager, a teacher and her
 * private test, which only she and the administrator may see.
 */
const SECOND_SCHOOL_ID = 'skola-druha'
/** Model in the call records; the administration test looks for it in the "Použití AI" overview. */
export const AI_USAGE_MODEL = 'google:e2e-pouziti'
export const PRIVATE_TEST_C = 'Soukromá písemka učitelky C'

/** A finished worksheet of the default account (`e2e/worksheets.spec.ts` hard-codes it). */
const E2E_WORKSHEET_ID = 'e2e-pracovni-list'
const SECOND_SCHOOL_ACCOUNTS = [
  { id: 'e2e-spravce-b', email: 'spravce.b@localhost', name: 'Správce B', role: 'spravce' as const },
  { id: 'e2e-ucitelka-c', email: 'ucitelka.c@localhost', name: 'Učitelka C', role: 'ucitelka' as const },
]

async function main() {
  if (onlyIfMissing && existsSync(dbFile)) {
    console.log(`Testovací databáze ${dbFile} už je, nechávám ji být.`)
    return
  }

  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${dbFile}${suffix}`, { force: true })

  const client = createClient({ url: `file:${dbFile}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: resolve(webRoot, 'drizzle') })

  /*
   * School and accounts. The main test run has sign-in off and works as the
   * default manager; the other accounts are for the signed-in run, which
   * checks that a teacher does not see someone else's test and preview cannot
   * change anything. The passwords are in the code on purpose — it is a
   * disposable test database.
   */
  await db.insert(schema.schools).values({ id: SCHOOL_ID, name: 'Vývoj', slug: 'vyvoj' })
  for (const account of ACCOUNTS) {
    await db.insert(schema.users).values({
      id: account.id,
      schoolId: SCHOOL_ID,
      email: account.email,
      name: account.name,
      role: account.role,
      passwordHash: account.password ? await hashPassword(account.password) : null,
    })
  }

  // Built-in templates — test printing and previews rely on `builtin-klasicka`.
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await db.insert(schema.templates).values({
      id: `builtin-${template.slug}`,
      schoolId: SCHOOL_ID,
      slug: template.slug,
      name: template.name,
      description: template.description,
      config: template.config,
      builtIn: true,
      position: index,
    })
  }

  await db.insert(schema.schools).values({ id: SECOND_SCHOOL_ID, name: 'Druhá škola', slug: 'druha' })
  for (const account of SECOND_SCHOOL_ACCOUNTS) {
    await db.insert(schema.users).values({
      ...account,
      schoolId: SECOND_SCHOOL_ID,
      passwordHash: await hashPassword(E2E_PASSWORD),
    })
  }
  await seedTemplates(db, SECOND_SCHOOL_ID)
  const [secondTemplate] = await db
    .select({ id: schema.templates.id })
    .from(schema.templates)
    .where(eq(schema.templates.schoolId, SECOND_SCHOOL_ID))
    .limit(1)
  await db.insert(schema.tests).values({
    id: newId(),
    schoolId: SECOND_SCHOOL_ID,
    ownerId: 'e2e-ucitelka-c',
    visibility: 'soukrome',
    title: PRIVATE_TEST_C,
    templateId: secondTemplate!.id,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
  })

  let subjectPosition = 0
  let materials = 0
  let topicCount = 0
  let questionCount = 0
  /**
   * Topic for the "AI kvalita" tab in Management: it needs questions with a
   * model set and a few `question_feedback` rows, otherwise the e2e test
   * would never see the table and would silently accept the empty state.
   */
  let aiQualityTopicId: string | null = null

  for (const subject of SUBJECTS) {
    const subjectId = newId()
    await db
      .insert(schema.subjects)
      .values({ id: subjectId, schoolId: SCHOOL_ID, name: subject.name, position: subjectPosition++ })

    let gradePosition = 0
    for (const grade of subject.grades) {
      const gradeId = newId()
      await db
        .insert(schema.grades)
        .values({
          id: gradeId,
          schoolId: SCHOOL_ID,
          subjectId,
          name: grade.name,
          position: gradePosition++,
        })

      let topicPosition = 0
      for (const topic of grade.topics) {
        const topicId = topic.id ?? newId()
        const body = text(topic.name, topic.sentence)
        await db.insert(schema.topics).values({
          id: topicId,
          schoolId: SCHOOL_ID,
          gradeId,
          name: topic.name,
          position: topicPosition++,
          usableCharCount: body.length,
          lowContent: body.length < MIN_USABLE_TOPIC_CHARS,
        })
        topicCount += 1
        if (topic.name === 'Fotosyntéza a dýchání rostlin') aiQualityTopicId = topicId

        const fileName = topic.fileName ?? `${topic.name}.txt`
        await db.insert(schema.materials).values({
          id: newId(),
          schoolId: SCHOOL_ID,
          topicId,
          fileName,
          relativePath: `${subject.name}/${grade.name}/${fileName}`,
          mimeType: 'text/plain',
          sizeBytes: body.length,
          text: body,
          charCount: body.length,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-${topicId}`,
        })
        materials += 1

        if (!topic.withQuestions) continue
        for (const question of questionSet(topic.name)) {
          await db.insert(schema.questions).values({
            id: newId(),
            schoolId: SCHOOL_ID,
            createdBy: DEFAULT_ACCOUNT_ID,
            topicId,
            materialId: null,
            type: question.type,
            payload: question.payload as never,
            blocks: [],
            points: question.points,
            difficulty: question.difficulty,
            source: 'manual',
            status: 'approved',
            // The bank search text is filled on every question write.
            searchText: `${JSON.stringify(question.payload)} `.toLocaleLowerCase('cs'),
          })
          questionCount += 1
        }
      }
    }
  }

  /**
   * Data for the "AI kvalita" tab in Management: four questions from one
   * model, two of them later regenerated with the same reason — so the
   * overview has something to compute (a 50 % share, the top reason "Moc
   * těžká", and the subject with the most regenerations) and the e2e test can
   * check concrete numbers.
   */
  if (aiQualityTopicId) {
    const AI_QUALITY_MODEL = 'e2e:model-a'
    const aiQuestionIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = newId()
      aiQuestionIds.push(id)
      const payload = {
        prompt: `AI kvalita: otázka ${i + 1}`,
        options: ['První možnost', 'Druhá možnost'],
        correctIndex: 0,
      }
      await db.insert(schema.questions).values({
        id,
        schoolId: SCHOOL_ID,
        createdBy: DEFAULT_ACCOUNT_ID,
        topicId: aiQualityTopicId,
        materialId: null,
        type: 'single_choice',
        payload,
        blocks: [],
        points: 1,
        difficulty: 2,
        source: 'ai',
        model: AI_QUALITY_MODEL,
        status: 'approved',
        searchText: `${JSON.stringify(payload)} `.toLocaleLowerCase('cs'),
      })
      questionCount += 1
    }
    // Only two of four were "regenerated" — the other two show the share can
    // be below 100 %.
    for (const questionId of aiQuestionIds.slice(0, 2)) {
      await db.insert(schema.questionFeedback).values({
        id: newId(),
        schoolId: SCHOOL_ID,
        questionId,
        replacementId: null,
        model: AI_QUALITY_MODEL,
        reason: 'tezka',
        note: null,
        createdBy: DEFAULT_ACCOUNT_ID,
      })
    }
  }

  /*
   * A few model calls for the "Použití AI" overview in administration:
   * success, limit and an unusable response, questions and a puzzle, in both
   * schools.
   */
  const calls = [
    { schoolId: SCHOOL_ID, task: 'otazky', model: AI_USAGE_MODEL, outcome: 'ok', inputTokens: 5200, outputTokens: 900 },
    { schoolId: SCHOOL_ID, task: 'otazky', model: AI_USAGE_MODEL, outcome: 'limit', inputTokens: null, outputTokens: null },
    { schoolId: SCHOOL_ID, task: 'otazky', model: 'openrouter:e2e-zaloha:free', outcome: 'ok', inputTokens: 4800, outputTokens: 850 },
    { schoolId: SCHOOL_ID, task: 'hlavolam', model: 'openrouter:e2e-zaloha:free', outcome: 'bad_shape', inputTokens: null, outputTokens: null },
    { schoolId: SECOND_SCHOOL_ID, task: 'otazky', model: AI_USAGE_MODEL, outcome: 'ok', inputTokens: 3100, outputTokens: 600 },
  ] as const
  for (const row of calls) {
    await db.insert(schema.aiCalls).values({ id: newId(), userId: null, durationMs: 4200, ...row })
  }

  /**
   * One finished worksheet so the worksheet overview has something to show
   * and the e2e tests for the "ověř" flag and faked generation have a target
   * (fixed id).
   */
  await db.insert(schema.tests).values({
    id: E2E_WORKSHEET_ID,
    schoolId: SCHOOL_ID,
    ownerId: DEFAULT_ACCOUNT_ID,
    kind: 'pracovni_list',
    title: 'E2E pracovní list o fotosyntéze',
    topicId: aiQualityTopicId,
    brief: JSON.stringify({ title: 'Fotosyntéza a dýchání rostlin', instructions: '', ownText: '' }),
    graded: false,
    templateId: 'builtin-pracovni-list',
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
  })
  const sheetItems = [
    { kind: 'heading' as const, text: 'Fotosyntéza' },
    { kind: 'text' as const, text: 'Rostliny ze světla, vody a oxidu uhličitého vyrábějí cukry.', content: { variant: 'text' } },
    { kind: 'text' as const, text: 'Jeden strom vyrobí za rok kyslík pro několik lidí.', content: { variant: 'fun_fact' }, needsCheck: true },
    {
      kind: 'table' as const,
      content: {
        header: ['Vstupuje', 'Vystupuje'],
        rows: [[{ value: 'oxid uhličitý', blank: false }, { value: 'kyslík', blank: true }]],
      },
    },
    {
      kind: 'question' as const,
      questionSnapshot: JSON.stringify({
        type: 'single_choice',
        points: 1,
        blocks: [],
        payload: { prompt: 'Co rostlina při fotosyntéze uvolňuje?', options: ['Kyslík', 'Dusík'], correctIndex: 0 },
      }),
    },
  ]
  await db.insert(schema.testItems).values(
    sheetItems.map((item, position) => ({
      id: newId(),
      schoolId: SCHOOL_ID,
      testId: E2E_WORKSHEET_ID,
      position,
      ...item,
    })),
  )

  client.close()
  console.log(
    `Testovací databáze ${dbFile} je hotová: ${SUBJECTS.length} předměty, ` +
      `${topicCount} témat, ${materials} materiálů, ${questionCount} otázek, ` +
      `${BUILT_IN_TEMPLATES.length} šablony.`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
