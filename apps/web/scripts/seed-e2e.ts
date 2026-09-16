/**
 * Postaví databázi pro testy v prohlížeči (Playwright) od nuly.
 *
 *   pnpm --filter @testmaker/web e2e:db            # postaví znovu (smaže starou)
 *   pnpm --filter @testmaker/web e2e:db --if-missing  # postaví, jen když ještě není
 *
 * Testy nesmějí sahat na ostrou `local.db` — jeden dřívější běh z ní smazal
 * skutečné předměty. Proto mají vlastní soubor `e2e.db`, který je kdykoli
 * k zahození: obsah je celý vymyšlený, nic se sem nekopíruje z knihovny
 * majitele.
 *
 * Data odpovídají tomu, co testy v `e2e/**` očekávají:
 *   - téma s „fotosyntéza“ v názvu pod předmětem PŘÍRODOPIS (hledání v knihovně),
 *   - téma „Měkkýši“ s materiálem, který má v názvu „Mollusca“ (hledání podle souboru),
 *   - ročník „6. ročník“ s dost tématy na rolování a s dlouhým názvem bez mezer,
 *   - témata se schválenými otázkami všech typů a obtížností (banka, osnova testu),
 *   - téma s pevným id `csxxOerbvKhz` (test zmrazení otázky ho má natvrdo),
 *   - vestavěné šablony `builtin-*` (náhledy šablon, tisk testu).
 */
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { nanoid } from 'nanoid'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import * as schema from '../src/db/schema'
import { MIN_USABLE_TOPIC_CHARS } from '../src/db/schema'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbFile = resolve(webRoot, process.env.E2E_DATABASE_FILE ?? 'e2e.db')
const onlyIfMissing = process.argv.includes('--if-missing')

const newId = () => nanoid(12)

/** Odstavec o zadaném tématu, dost dlouhý, aby téma nebylo „chudé“. */
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

/** Sada otázek všech běžných typů a obtížností pro jedno téma. */
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
  /** Pevné id se vyplňuje jen tam, kde ho nějaký test zná natvrdo. */
  id?: string
  name: string
  /** Název souboru materiálu; když chybí, odvodí se z názvu tématu. */
  fileName?: string
  sentence: string
  /** Téma dostane sadu otázek (banka otázek, osnova testu). */
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
 * Doplňková témata, aby měl ročník co rolovat (test na rolování čeká obsah
 * delší než okno) a dlaždice se měly kam lámat.
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
            // Shoda padne na název souboru, ne na název tématu — hledání podle
            // „Mollusca“ pak ukáže, že se trefilo do souboru.
            fileName: '6.22 Měkkýši (Mollusca) — zápis do sešitu.txt',
            sentence: 'Měkkýši mají měkké tělo, často chráněné schránkou, a patří mezi bezobratlé.',
            withQuestions: true,
          },
          {
            // Dlouhý název bez mezer: přesně na něm se pozná, jestli se dlaždice
            // umí zalomit, nebo text vyčnívá ven.
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
            // Test zmrazení otázky má tohle id natvrdo v souboru.
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

async function main() {
  if (onlyIfMissing && existsSync(dbFile)) {
    console.log(`Testovací databáze ${dbFile} už je, nechávám ji být.`)
    return
  }

  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${dbFile}${suffix}`, { force: true })

  const client = createClient({ url: `file:${dbFile}` })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: resolve(webRoot, 'drizzle') })

  // Vestavěné šablony — na `builtin-klasicka` stojí tisk testu i náhledy.
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await db.insert(schema.templates).values({
      id: `builtin-${template.slug}`,
      slug: template.slug,
      name: template.name,
      description: template.description,
      config: template.config,
      builtIn: true,
      position: index,
    })
  }

  let subjectPosition = 0
  let materials = 0
  let topicCount = 0
  let questionCount = 0

  for (const subject of SUBJECTS) {
    const subjectId = newId()
    await db
      .insert(schema.subjects)
      .values({ id: subjectId, name: subject.name, position: subjectPosition++ })

    let gradePosition = 0
    for (const grade of subject.grades) {
      const gradeId = newId()
      await db
        .insert(schema.grades)
        .values({ id: gradeId, subjectId, name: grade.name, position: gradePosition++ })

      let topicPosition = 0
      for (const topic of grade.topics) {
        const topicId = topic.id ?? newId()
        const body = text(topic.name, topic.sentence)
        await db.insert(schema.topics).values({
          id: topicId,
          gradeId,
          name: topic.name,
          position: topicPosition++,
          usableCharCount: body.length,
          lowContent: body.length < MIN_USABLE_TOPIC_CHARS,
        })
        topicCount += 1

        const fileName = topic.fileName ?? `${topic.name}.txt`
        await db.insert(schema.materials).values({
          id: newId(),
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
            topicId,
            materialId: null,
            type: question.type,
            payload: question.payload as never,
            blocks: [],
            points: question.points,
            difficulty: question.difficulty,
            source: 'manual',
            status: 'approved',
            // Text pro hledání v bance se plní při každém zápisu otázky.
            searchText: `${JSON.stringify(question.payload)} `.toLocaleLowerCase('cs'),
          })
          questionCount += 1
        }
      }
    }
  }

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
