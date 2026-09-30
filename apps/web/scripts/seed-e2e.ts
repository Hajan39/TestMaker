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
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { nanoid } from 'nanoid'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import * as schema from '../src/db/schema'
import { nasaditSablony } from '../src/db/sablony'
import { zahesovat } from '../src/lib/heslo'
import { VYCHOZI_UCET_ID } from '../src/lib/vychozi'
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

/** Škola, do které patří všechna zkušební data. */
const SKOLA_ID = 'skola-vyvoj'

/**
 * Účty pro testy. Hesla jsou stejná jako v `playwright.login.config.ts`;
 * testovací databáze se kdykoli zahodí, takže tady nic tajného není.
 */
export const E2E_HESLO = 'e2e-tajne-heslo'
const UCTY = [
  {
    id: VYCHOZI_UCET_ID,
    email: 'spravce@localhost',
    name: 'Vývojový správce',
    role: 'spravce' as const,
    heslo: E2E_HESLO,
  },
  {
    id: 'e2e-ucitelka-a',
    email: 'ucitelka.a@localhost',
    name: 'Učitelka A',
    role: 'ucitelka' as const,
    heslo: E2E_HESLO,
  },
  {
    id: 'e2e-ucitelka-b',
    email: 'ucitelka.b@localhost',
    name: 'Učitelka B',
    role: 'ucitelka' as const,
    heslo: E2E_HESLO,
  },
  {
    id: 'e2e-nahled',
    email: 'nahled@localhost',
    name: 'Náhled',
    role: 'nahled' as const,
    heslo: E2E_HESLO,
  },
  {
    id: 'e2e-administrator',
    email: 'admin@localhost',
    name: 'Administrátor',
    role: 'administrator' as const,
    heslo: E2E_HESLO,
  },
]

/**
 * Druhá škola pro testy administrátora: vlastní správce, učitelka a její
 * soukromá písemka, kterou smí vidět jen ona a administrátor.
 */
const DRUHA_SKOLA_ID = 'skola-druha'
/** Model v záznamech volání; test administrace ho hledá v přehledu „Použití AI“. */
export const AI_POUZITI_MODEL = 'google:e2e-pouziti'
export const SOUKROMA_PISEMKA_C = 'Soukromá písemka učitelky C'
const UCTY_DRUHE_SKOLY = [
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
   * Škola a účty. Hlavní běh testů jede s vypnutým přihlašováním a pracuje pod
   * výchozím správcem; ostatní účty jsou tu pro běh s přihlášením, kde se
   * ověřuje, že učitelka nevidí cizí písemku a náhled nesmí nic měnit.
   * Hesla jsou schválně v kódu — je to zahoditelná testovací databáze.
   */
  await db.insert(schema.schools).values({ id: SKOLA_ID, name: 'Vývoj', slug: 'vyvoj' })
  for (const ucet of UCTY) {
    await db.insert(schema.users).values({
      id: ucet.id,
      schoolId: SKOLA_ID,
      email: ucet.email,
      name: ucet.name,
      role: ucet.role,
      passwordHash: ucet.heslo ? await zahesovat(ucet.heslo) : null,
    })
  }

  // Vestavěné šablony — na `builtin-klasicka` stojí tisk testu i náhledy.
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await db.insert(schema.templates).values({
      id: `builtin-${template.slug}`,
      schoolId: SKOLA_ID,
      slug: template.slug,
      name: template.name,
      description: template.description,
      config: template.config,
      builtIn: true,
      position: index,
    })
  }

  await db.insert(schema.schools).values({ id: DRUHA_SKOLA_ID, name: 'Druhá škola', slug: 'druha' })
  for (const ucet of UCTY_DRUHE_SKOLY) {
    await db.insert(schema.users).values({
      ...ucet,
      schoolId: DRUHA_SKOLA_ID,
      passwordHash: await zahesovat(E2E_HESLO),
    })
  }
  await nasaditSablony(db, DRUHA_SKOLA_ID)
  const [sablonaDruhe] = await db
    .select({ id: schema.templates.id })
    .from(schema.templates)
    .where(eq(schema.templates.schoolId, DRUHA_SKOLA_ID))
    .limit(1)
  await db.insert(schema.tests).values({
    id: newId(),
    schoolId: DRUHA_SKOLA_ID,
    ownerId: 'e2e-ucitelka-c',
    visibility: 'soukrome',
    title: SOUKROMA_PISEMKA_C,
    templateId: sablonaDruhe!.id,
    header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
  })

  let subjectPosition = 0
  let materials = 0
  let topicCount = 0
  let questionCount = 0
  /**
   * Téma pro záložku „AI kvalita“ ve Správě: potřebuje otázky s nastaveným
   * modelem a pár řádků `question_feedback`, jinak by e2e test tabulku
   * nikdy nedostal na oči a jen by tiše přijal prázdný stav.
   */
  let aiKvalitaTopicId: string | null = null

  for (const subject of SUBJECTS) {
    const subjectId = newId()
    await db
      .insert(schema.subjects)
      .values({ id: subjectId, schoolId: SKOLA_ID, name: subject.name, position: subjectPosition++ })

    let gradePosition = 0
    for (const grade of subject.grades) {
      const gradeId = newId()
      await db
        .insert(schema.grades)
        .values({
          id: gradeId,
          schoolId: SKOLA_ID,
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
          schoolId: SKOLA_ID,
          gradeId,
          name: topic.name,
          position: topicPosition++,
          usableCharCount: body.length,
          lowContent: body.length < MIN_USABLE_TOPIC_CHARS,
        })
        topicCount += 1
        if (topic.name === 'Fotosyntéza a dýchání rostlin') aiKvalitaTopicId = topicId

        const fileName = topic.fileName ?? `${topic.name}.txt`
        await db.insert(schema.materials).values({
          id: newId(),
          schoolId: SKOLA_ID,
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
            schoolId: SKOLA_ID,
            createdBy: VYCHOZI_UCET_ID,
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

  /**
   * Data pro záložku „AI kvalita“ ve Správě: čtyři otázky od jednoho modelu,
   * z toho dvě později přegenerované se stejným důvodem — přehled tak má co
   * spočítat (podíl 50 %, nejčastější důvod „Moc těžká“, i předmět s nejvíc
   * přegenerováním) a e2e test si na konkrétní čísla může sáhnout.
   */
  if (aiKvalitaTopicId) {
    const AI_KVALITA_MODEL = 'e2e:model-a'
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
        schoolId: SKOLA_ID,
        createdBy: VYCHOZI_UCET_ID,
        topicId: aiKvalitaTopicId,
        materialId: null,
        type: 'single_choice',
        payload,
        blocks: [],
        points: 1,
        difficulty: 2,
        source: 'ai',
        model: AI_KVALITA_MODEL,
        status: 'approved',
        searchText: `${JSON.stringify(payload)} `.toLocaleLowerCase('cs'),
      })
      questionCount += 1
    }
    // Jen dvě ze čtyř se „přegenerovaly“ — zbylé dvě ukazují, že podíl umí
    // být i menší než 100 %.
    for (const questionId of aiQuestionIds.slice(0, 2)) {
      await db.insert(schema.questionFeedback).values({
        id: newId(),
        schoolId: SKOLA_ID,
        questionId,
        replacementId: null,
        model: AI_KVALITA_MODEL,
        reason: 'tezka',
        note: null,
        createdBy: VYCHOZI_UCET_ID,
      })
    }
  }

  /*
   * Pár volání modelu pro přehled „Použití AI“ v administraci: úspěch, limit
   * a nepoužitelná odpověď, otázky i hlavolam, v obou školách.
   */
  const volani = [
    { schoolId: SKOLA_ID, task: 'otazky', model: AI_POUZITI_MODEL, outcome: 'ok', inputTokens: 5200, outputTokens: 900 },
    { schoolId: SKOLA_ID, task: 'otazky', model: AI_POUZITI_MODEL, outcome: 'limit', inputTokens: null, outputTokens: null },
    { schoolId: SKOLA_ID, task: 'otazky', model: 'openrouter:e2e-zaloha:free', outcome: 'ok', inputTokens: 4800, outputTokens: 850 },
    { schoolId: SKOLA_ID, task: 'hlavolam', model: 'openrouter:e2e-zaloha:free', outcome: 'bad_shape', inputTokens: null, outputTokens: null },
    { schoolId: DRUHA_SKOLA_ID, task: 'otazky', model: AI_POUZITI_MODEL, outcome: 'ok', inputTokens: 3100, outputTokens: 600 },
  ] as const
  for (const radek of volani) {
    await db.insert(schema.aiCalls).values({ id: newId(), userId: null, durationMs: 4200, ...radek })
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
