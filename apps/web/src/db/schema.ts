import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type {
  Block,
  PuzzleContent,
  PuzzleEntry,
  QuestionContent,
  TemplateConfig,
  TestHeaderConfig,
} from '@testmaker/core/schema'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

export const subjects = sqliteTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [uniqueIndex('subjects_name_idx').on(table.name)],
)

export const grades = sqliteTable(
  'grades',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    /** Prázdné pro předměty bez členění na ročníky. */
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => [uniqueIndex('grades_subject_name_idx').on(table.subjectId, table.name)],
)

/** Pod tímto počtem znaků použitelného textu na písemku spolehlivě nevystačí. */
export const MIN_USABLE_TOPIC_CHARS = 1000

export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    /**
     * Součet `charCount` materiálů tématu bez duplicit — udržuje se při
     * každé změně materiálů (import, smazání, označení duplicity), aby na
     * něj šlo v seznamu témat rovnou spoléhat bez dalších dotazů.
     */
    usableCharCount: integer('usable_char_count').notNull().default(0),
    /** `usableCharCount` pod `MIN_USABLE_TOPIC_CHARS` — na písemku nevystačí. */
    lowContent: integer('low_content', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [uniqueIndex('topics_grade_name_idx').on(table.gradeId, table.name)],
)

export const materials = sqliteTable(
  'materials',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    relativePath: text('relative_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull(),
    pageCount: integer('page_count'),
    needsOcr: integer('needs_ocr', { mode: 'boolean' }).notNull().default(false),
    contentHash: text('content_hash').notNull(),
    /**
     * Vyplněno, když jde o jiný export téhož obsahu (typicky PDF vytištěné
     * z prezentace). Takový materiál se při generování přeskakuje.
     *
     * Cizí klíč se `set null` — smazáním originálu se odkaz na něj zruší,
     * místo aby zůstal viset do prázdna a materiál se navždy tiše
     * přeskakoval, aniž by o tom kdokoli věděl.
     */
    duplicateOfId: text('duplicate_of_id').references((): AnySQLiteColumn => materials.id, {
      onDelete: 'set null',
    }),
    /** Míra shody s materiálem v `duplicateOfId` (0–1). */
    duplicateScore: real('duplicate_score'),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    /**
     * Tentýž soubor smí být v knihovně vícekrát — pracovní list se používá
     * v sedmém i osmém ročníku a v obou tématech musí být vidět. Unikátní je
     * proto až dvojice tématu a obsahu: podruhé se nenaimportuje jen do téhož
     * tématu.
     */
    uniqueIndex('materials_topic_hash_idx').on(table.topicId, table.contentHash),
    index('materials_topic_idx').on(table.topicId),
    index('materials_duplicate_idx').on(table.duplicateOfId),
    /**
     * Hledání podle samotného obsahu (import se ptá „známe už tenhle hash?“
     * napříč tématy). Složený index výš začíná tématem, takže na tenhle dotaz
     * použít nejde a import každého souboru četl celou tabulku materiálů
     * i s texty.
     */
    index('materials_content_hash_idx').on(table.contentHash),
  ],
)

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  mimeType: text('mime_type').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull().default(now),
})

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    type: text('type').notNull().$type<QuestionContent['type']>(),
    payload: text('payload', { mode: 'json' }).notNull().$type<QuestionContent['payload']>(),
    blocks: text('blocks', { mode: 'json' }).notNull().default(sql`'[]'`).$type<Block[]>(),
    points: real('points').notNull().default(1),
    difficulty: integer('difficulty').notNull().default(2),
    explanation: text('explanation'),
    source: text('source').notNull().default('ai').$type<'ai' | 'manual'>(),
    status: text('status').notNull().default('draft').$type<'draft' | 'approved' | 'rejected'>(),
    createdAt: text('created_at').notNull().default(now),
    /** Soubor, ze kterého otázka vznikla. */
    sourceFile: text('source_file'),
    /** Pasáž z materiálu, o kterou se správná odpověď opírá. */
    sourceQuote: text('source_quote'),
    /**
     * Model, který otázku vygeneroval (`google:gemini-flash-latest`). Slouží
     * jen k pozdějšímu porovnání kvality, když se v jednom tématu vystřídalo
     * víc modelů ze žebříčku — v rozhraní se nikde nezobrazuje, učitelku to
     * nezajímá. Prázdné u ručně psaných otázek i u všeho staršího.
     */
    model: text('model'),
    /**
     * Text otázky (zadání, možnosti, odpovědi i vysvětlení) malými písmeny —
     * jen pro hledání v bance. Bez něj by se hledalo v prohlížeči nad vším,
     * co se stáhlo, a banka by se kvůli tomu musela posílat celá.
     *
     * Plní se při každém zápisu otázky (`searchTextFor` v `lib/questions.ts`)
     * a malá písmena se dělají v JavaScriptu, aby se česká písmena s háčky
     * chovala stejně jako ostatní — `lower()` v SQLite umí jen ASCII.
     */
    searchText: text('search_text').notNull().default(''),
  },
  (table) => [
    /**
     * Nejčastější dotaz v aplikaci: otázky jednoho tématu, obvykle zúžené
     * stavem (koncepty ke kontrole, doplňování počtu v `resolveCount`).
     * Nahrazuje dřívější index jen podle tématu — ten je jeho předponou,
     * takže dotazy bez stavu zvládne taky.
     */
    index('questions_topic_status_idx').on(table.topicId, table.status),
    index('questions_material_idx').on(table.materialId),
    index('questions_status_idx').on(table.status),
    /**
     * Řazení seznamů a stránkování kurzorem jde vždycky podle dvojice
     * (`created_at`, `id`) — bez indexu se kvůli každé stránce řadila celá
     * banka.
     */
    index('questions_created_idx').on(table.createdAt, table.id),
  ],
)

/**
 * Hlavolamy (osmisměrka, tajenka). Vlastní tabulka, ne další druh otázky:
 * hlavolam nemá odpověď ani body, negeneruje se do banky a učitelka ho hledá
 * jinde než otázky. Do písemky se zařadí jako položka testu (`test_items`
 * druhu `puzzle`), která si nese zmrazený snímek — stejně jako otázka.
 */
export const puzzles = sqliteTable(
  'puzzles',
  {
    id: text('id').primaryKey(),
    /** Hlavolam vzniká z materiálů tématu; bez tématu zůstane po jeho smazání. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().$type<PuzzleContent['kind']>(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    /** Dvojice slovo + nápověda; mřížku z nich skládá kód, ne databáze. */
    entries: text('entries', { mode: 'json' }).notNull().$type<PuzzleEntry[]>(),
    /** Nastavení podle druhu: velikost mřížky a seed, nebo tajená věta. */
    payload: text('payload', { mode: 'json' }).notNull().$type<PuzzleContent['payload']>(),
    /** Model, který dodal slovní zásobu; prázdné u ručně psaných hlavolamů. */
    model: text('model'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    index('puzzles_topic_idx').on(table.topicId),
    /** Seznam hlavolamů se řadí od nejnovějšího. */
    index('puzzles_created_idx').on(table.createdAt, table.id),
  ],
)

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    /** Generuje se vždy z celé skupiny materiálů, tedy z tématu. */
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    params: text('params', { mode: 'json' }).notNull().$type<GenerationJobParams>(),
    status: text('status').notNull().default('queued').$type<'queued' | 'running' | 'done' | 'error'>(),
    producedCount: integer('produced_count').notNull().default(0),
    error: text('error'),
    createdAt: text('created_at').notNull().default(now),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    index('generation_jobs_status_idx').on(table.status),
    /**
     * Rezervace tématu (`claimTopic`, `isTopicBusy`) i zařazování do fronty
     * se ptají na dvojici tématu a stavu. Index jen podle stavu na to nestačí:
     * čekajících a běžících úloh je málo, ale hotových přibývá donekonečna.
     */
    index('generation_jobs_topic_status_idx').on(table.topicId, table.status),
  ],
)

export interface GenerationJobParams {
  count: number
  types: QuestionContent['type'][]
  difficulty: 1 | 2 | 3 | 'mix'
  /** `add` = tolik nových otázek, `target` = doplnit téma na tenhle počet. */
  mode?: 'add' | 'target'
}

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    config: text('config', { mode: 'json' }).notNull().$type<TemplateConfig>(),
    builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (table) => [uniqueIndex('templates_slug_idx').on(table.slug)],
)

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  /** Test na známky — bez toho se netisknou body ani políčko na známku. */
  graded: integer('graded', { mode: 'boolean' }).notNull().default(true),
  templateId: text('template_id')
    .notNull()
    .references(() => templates.id),
  header: text('header', { mode: 'json' }).notNull().$type<TestHeaderConfig>(),
  variants: integer('variants').notNull().default(1),
  showKey: integer('show_key', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
})

export const testItems = sqliteTable(
  'test_items',
  {
    id: text('id').primaryKey(),
    testId: text('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').notNull().$type<'question' | 'heading' | 'instruction' | 'page_break' | 'puzzle'>(),
    /**
     * Odkaz do banky otázek. Cizí klíč se `set null`: smazáním otázky se
     * položka z hotového testu nesmí ztratit — co je na papíře, drží
     * `questionSnapshot`, odkaz slouží už jen k porovnání s bankou.
     */
    questionId: text('question_id').references(() => questions.id, { onDelete: 'set null' }),
    text: text('text'),
    pointsOverride: real('points_override'),
    /**
     * Přepis počtu linek na odpověď pro tuhle otázku v tomhle testu. Kolik
     * místa žák potřebuje, záleží na písemce, ne na otázce — v opakování na
     * závěr roku se u téže otázky hodí víc místa než v krátkém desetiminutovém
     * testu. Prázdné = platí, co má otázka sama.
     */
    linesOverride: integer('lines_override'),
    /**
     * Zmrazený obsah otázky (JSON podle `questionSnapshotSchema`) v podobě,
     * v jaké se otázka do testu zařadila. Vykreslení, náhled i klíč čtou
     * odtud — jinak by pozdější úprava otázky tiše přepsala už vytištěnou
     * písemku a klíč by neodpovídal zadání. Prázdné u testů založených
     * dřív, než se snímky zavedly.
     */
    questionSnapshot: text('question_snapshot'),
    /**
     * Odkaz na hlavolam u položky druhu `puzzle`. Cizí klíč se `set null`
     * ze stejného důvodu jako u otázky: smazáním hlavolamu z knihovny se
     * hotová písemka nesmí změnit — co je na papíře, drží `puzzleSnapshot`.
     */
    puzzleId: text('puzzle_id').references(() => puzzles.id, { onDelete: 'set null' }),
    /** Zmrazený obsah hlavolamu (JSON podle `puzzleContentSchema`). */
    puzzleSnapshot: text('puzzle_snapshot'),
  },
  (table) => [
    index('test_items_test_idx').on(table.testId, table.position),
    /**
     * Cizí klíč se `set null`: při každém smazání otázky musí SQLite najít
     * položky testů, které na ni ukazují. Bez indexu kvůli tomu projde celou
     * tabulku i se zmrazenými snímky otázek.
     */
    index('test_items_question_idx').on(table.questionId),
    /** Týž důvod jako u otázek: `set null` musí najít položky bez čtení celé tabulky. */
    index('test_items_puzzle_idx').on(table.puzzleId),
  ],
)

export type SubjectRow = typeof subjects.$inferSelect
export type GradeRow = typeof grades.$inferSelect
export type TopicRow = typeof topics.$inferSelect
export type MaterialRow = typeof materials.$inferSelect
export type QuestionRow = typeof questions.$inferSelect
export type TemplateRow = typeof templates.$inferSelect
export type TestRow = typeof tests.$inferSelect
export type TestItemRow = typeof testItems.$inferSelect
export type GenerationJobRow = typeof generationJobs.$inferSelect
export type PuzzleRow = typeof puzzles.$inferSelect
