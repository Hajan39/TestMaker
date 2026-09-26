import 'server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { generateQuestions } from '@testmaker/core/ai'
import { AI_QUESTION_TYPES, type Question, type QuestionType } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, subjects, topics, users } from '@/db'
import { skola, type Scope } from '@/lib/uzivatel'
import { newId } from '@/lib/ids'
import { insertQuestions, loadAvoidPrompts, toQuestion } from './questions'

export interface GenerateParams {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
  /**
   * `add` = vytvoř `count` nových otázek.
   * `target` = doplň téma tak, aby v něm bylo dohromady `count` otázek.
   * Doplňování je to, co učitelka chce u tématu, kde už něco má: část otázek
   * zamítne a potřebuje dorovnat počet, ne začínat znovu.
   */
  mode?: 'add' | 'target'
}

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
  mode: 'add',
}

/**
 * Kolik otázek se má v tomhle běhu opravdu vytvořit. U doplňování se počítají
 * jen otázky, které v tématu zůstaly použitelné — zamítnuté se do počtu
 * nepočítají, jinak by doplnění nikdy nic nevytvořilo.
 */
export async function resolveCount(
  scope: Scope,
  topicId: string,
  params: GenerateParams,
): Promise<number> {
  if (params.mode !== 'target') return params.count
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(
      and(skola(scope, questions), eq(questions.topicId, topicId), ne(questions.status, 'rejected')),
    )
  return Math.max(0, params.count - Number(row?.value ?? 0))
}

export interface GenerateOutcome {
  created: number
  rejected: number
  /** Volání, ze kterých nešlo použít nic. */
  failedCalls: number
  topicId: string
  /** Z kolika materiálů se generovalo. */
  sources: number
  /**
   * Modely, které otázky vyrobily (`poskytovatel:model`). Víc než jeden
   * znamená, že se v tématu při vyčerpaném limitu přepnulo dál v žebříčku —
   * kvalita se mezi modely liší, takže to musí být z hlášky poznat.
   */
  models: string[]
}

/**
 * Zabere téma pro generování. Dvě generování nad týmž tématem naráz o sobě
 * nevědí — seznam „těmhle otázkám se vyhni" si každé načte na začátku, takže
 * by spolehlivě vyrobila duplicity. Rezervace se vede v téže tabulce jako
 * fronta, aby se hromadné generování a ruční spuštění viděly navzájem.
 *
 * Vrací id rezervace, nebo `null`, když už téma někdo zpracovává.
 */
/**
 * Zámek je na téma, ne na učitelku: knihovna je společná a dvě generování nad
 * týmž tématem naráz by do ní nasypala tytéž otázky.
 */
export async function claimTopic(scope: Scope, topicId: string): Promise<string | null> {
  const id = newId()
  const startedAt = new Date().toISOString()

  // Celá rezervace je jeden příkaz: `insert … select … where not exists`.
  // Čtení a zápis ve dvou krocích nad Turso atomické nejsou — mezi ně se vejde
  // druhé generování a obě si téma zaberou. Jeden příkaz zapisuje pod zámkem
  // databáze, takže podmínku vyhodnotí právě jeden z nich.
  const claimed = await db.all<{ id: string }>(sql`
    insert into ${generationJobs} (id, school_id, requested_by, topic_id, params, status, started_at)
    select ${id}, ${scope.schoolId}, ${scope.userId}, ${topicId},
           ${JSON.stringify(DEFAULT_GENERATE_PARAMS)}, 'running', ${startedAt}
    where not exists (
      select 1 from ${generationJobs}
      where topic_id = ${topicId} and status in ('queued', 'running')
    )
    returning id
  `)

  return claimed.length > 0 ? id : null
}

/** Uvolní rezervaci tématu a zapíše, jak generování dopadlo. */
export async function releaseTopic(
  jobId: string,
  outcome: { created?: number; error?: string } = {},
): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: outcome.error ? 'error' : 'done',
      error: outcome.error ?? null,
      producedCount: outcome.created ?? 0,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(generationJobs.id, jobId))
}

/** Text celé skupiny materiálů jednoho tématu, s hlavičkami podle souborů. */
export async function loadTopicSource(
  scope: Scope,
  topicId: string,
): Promise<{
  text: string
  topicName: string
  gradeName: string
  subjectName: string
  sources: number
} | null> {
  const [meta] = await db
    .select({ topicName: topics.name, gradeName: grades.name, subjectName: subjects.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, topics), eq(topics.id, topicId)))
    .limit(1)
  if (!meta) return null

  // Duplicitní exporty téhož obsahu do zdroje nepatří — jen by otázky zdvojily.
  const rows = await db
    .select({ fileName: materials.fileName, text: materials.text })
    .from(materials)
    .where(and(skola(scope, materials), eq(materials.topicId, topicId), isNull(materials.duplicateOfId)))
    .orderBy(asc(materials.fileName))

  const text = rows
    .map((row) => `=== ${row.fileName} ===\n${row.text}`)
    .join('\n\n')
    .trim()

  return { ...meta, text, sources: rows.length }
}

/**
 * Vygeneruje otázky z celé skupiny materiálů jednoho tématu.
 * Jeden soubor často na písemku nestačí a generování po souborech vede
 * k opakujícím se otázkám, proto je vstupem vždy celé téma.
 */
export async function generateForTopic(
  scope: Scope,
  topicId: string,
  params: GenerateParams,
  options: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
    /**
     * Zavolá se po každé uložené dávce otázek. Generování trvá i deset minut
     * a jediné, co učitelce řekne, že se opravdu něco děje, jsou otázky, které
     * mezitím přibyly — proto putují ven rovnou, ne až na konci.
     */
    onSaved?: (info: { created: number; questions: Question[] }) => void | Promise<void>
    /** Podvržené generování pro testy; v aplikaci se nepředává. */
    generate?: typeof generateQuestions
  } = {},
): Promise<GenerateOutcome> {
  const wanted = await resolveCount(scope, topicId, params)
  if (wanted <= 0) {
    return { created: 0, rejected: 0, failedCalls: 0, topicId, sources: 0, models: [] }
  }

  const source = await loadTopicSource(scope, topicId)
  if (!source) throw new Error('Téma nenalezeno')
  if (source.text.trim().length < 200) {
    throw new Error('Materiály tématu obsahují příliš málo textu na generování otázek')
  }

  const avoid = await loadAvoidPrompts(scope, topicId)

  // Ukládáme po dávkách. Kdyby volání modelu v půlce selhalo, zůstane hotová práce.
  let created = 0
  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: wanted,
      types: params.types,
      difficulty: params.difficulty,
      avoid,
    },
    {
      signal: options.signal,
      onChunk: options.onProgress,
      onBatch: async (batch, info) => {
        const ids = await insertQuestions(scope, batch, { topicId, source: 'ai' })
        // Který model otázku vyrobil, se ukládá jen do databáze pro pozdější
        // porovnání kvality — v rozhraní se nikde nezobrazuje. Zapisuje se
        // zvlášť, aby `insertQuestions` zůstalo o obsahu otázky, ne o tom,
        // odkud přišla.
        if (ids.length > 0) await db.update(questions).set({ model: info.model }).where(inArray(questions.id, ids))
        created += batch.length

        // Hotové otázky ven ještě za běhu — ale jen když o ně někdo stojí,
        // aby se ve frontě (kde je nikdo nečte) nedělal dotaz navíc.
        if (options.onSaved && ids.length > 0) {
          const rows = await db
            .select()
            .from(questions)
            .where(and(skola(scope, questions), inArray(questions.id, ids)))
          // Pořadí z databáze není zaručené; vracíme dávku tak, jak vznikla.
          const byId = new Map(rows.map((row) => [row.id, toQuestion(row)]))
          await options.onSaved({
            created,
            questions: ids.flatMap((id) => {
              const question = byId.get(id)
              return question ? [question] : []
            }),
          })
        }
      },
    },
  )

  return {
    created,
    rejected: result.rejected.length,
    failedCalls: result.failedCalls.length,
    topicId,
    sources: source.sources,
    models: result.models,
  }
}

/**
 * Běží nad tématem právě dávkové generování? Náhrada jedné otázky si téma
 * nerezervuje (`claimTopic`) — kvůli jedné otázce by zablokovala celé téma na
 * několik minut. Čte ale rezervaci cizí: kdyby se náhrada trefila doprostřed
 * dávky, obě volání by pracovala se stejným seznamem „těmhle se vyhni".
 */
export async function isTopicBusy(scope: Scope, topicId: string): Promise<{ kdo: string } | null> {
  const [running] = await db
    .select({ id: generationJobs.id, kdo: users.name })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.requestedBy))
    .where(
      and(
        skola(scope, generationJobs),
        eq(generationJobs.topicId, topicId),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
    .limit(1)
  return running ? { kdo: running.kdo } : null
}

export const TOPIC_BUSY_MESSAGE =
  'Nad tímhle tématem právě běží generování. Počkej, než doběhne, a zkus to znovu.'

/** Hláška i se jménem — bez něj vypadá zablokované téma jako porucha. */
export function topicBusyMessage(kdo: string): string {
  return `Nad tímhle tématem právě generuje ${kdo}. Počkej, než to doběhne, a zkus to znovu.`
}

/**
 * Nahradí jednu otázku novou od modelu.
 *
 * Pořadí je to podstatné: nejdřív musí náhrada vzniknout, teprve pak se
 * původní otázka označí jako zamítnutá. Když model selže nebo vrátí něco
 * nepoužitelného, nezmění se v databázi nic a volající dostane českou hlášku
 * (`describeAiError`) — jinak by po nepovedeném pokusu zůstalo v tématu o
 * jednu otázku míň a učitelka by nevěděla, kam se poděla.
 *
 * `generate` se dá podstrčit v testech; v aplikaci se nepředává.
 */
export async function regenerateQuestion(
  scope: Scope,
  questionId: string,
  options: { signal?: AbortSignal; generate?: typeof generateQuestions } = {},
): Promise<Question> {
  const [original] = await db
    .select()
    .from(questions)
    .where(and(skola(scope, questions), eq(questions.id, questionId)))
    .limit(1)
  if (!original) throw new Error('Otázka nenalezena')
  if (!original.topicId) throw new Error('Otázka nepatří k žádnému tématu, nemá se z čeho generovat náhrada')

  const topicId = original.topicId
  const busy = await isTopicBusy(scope, topicId)
  if (busy) throw new Error(topicBusyMessage(busy.kdo))

  const type = original.type
  if (!AI_QUESTION_TYPES.includes(type as (typeof AI_QUESTION_TYPES)[number])) {
    throw new Error('Tenhle typ otázky model generovat neumí, uprav ji prosím ručně')
  }

  const source = await loadTopicSource(scope, topicId)
  if (!source) throw new Error('Téma nenalezeno')
  if (source.text.trim().length < 200) {
    throw new Error('Materiály tématu obsahují příliš málo textu na generování otázek')
  }

  // Nahrazovaná otázka je v seznamu „vyhni se" taky — jinak by model klidně
  // vrátil tutéž otázku, kterou učitelka právě zavrhla.
  const avoid = await loadAvoidPrompts(scope, topicId)

  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: 1,
      types: [type as (typeof AI_QUESTION_TYPES)[number]],
      difficulty: (original.difficulty as 1 | 2 | 3) ?? 2,
      avoid,
      // Náhrada vzniká z pasáže, o kterou se opírala původní otázka — jinak
      // by model dostal vždy první úsek tématu, ať šlo o cokoli.
      ...(original.sourceQuote?.trim() ? { focus: original.sourceQuote } : {}),
    },
    { signal: options.signal },
  )

  const replacement = result.questions[0]
  if (!replacement) {
    throw new Error('Model nevrátil použitelnou náhradu. Zkus to prosím znovu.')
  }

  // Až teď — náhrada je na světě, původní otázka může odejít.
  const [newId] = await insertQuestions(scope, [replacement], { topicId, source: 'ai' })
  // Model jen do databáze, stejně jako u dávkového generování (v rozhraní nikde).
  const usedModel = result.models[0]
  if (newId && usedModel) await db.update(questions).set({ model: usedModel }).where(eq(questions.id, newId))
  await db
    .update(questions)
    .set({ status: 'rejected', reviewedBy: scope.userId, reviewedAt: new Date().toISOString() })
    .where(and(skola(scope, questions), eq(questions.id, questionId)))

  const [row] = await db
    .select()
    .from(questions)
    .where(and(skola(scope, questions), eq(questions.id, newId!)))
    .limit(1)
  if (!row) throw new Error('Náhradu se nepodařilo uložit')
  return toQuestion(row)
}
