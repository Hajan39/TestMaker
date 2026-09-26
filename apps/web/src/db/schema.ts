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
import type { Role, UserStatus } from '../lib/role'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

/**
 * Škola je nejvyšší hranice dat: knihovna, testy i fronta patří právě jedné.
 * Dnes je řádek jediný — díky téhle tabulce je ale druhá škola vložením
 * řádku, ne migrací napříč celým modelem.
 */
export const schools = sqliteTable(
  'schools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * Doména školních účtů Google (`hd` z přihlášení). Prázdné znamená, že se
     * přes Google přihlásit nedá — jedině účtem s heslem.
     */
    googleDomain: text('google_domain'),
    /**
     * Co s účtem ze správné domény, který v aplikaci ještě není: buď se
     * odmítne a správce ho založí ručně (výchozí), nebo vznikne účet ve stavu
     * `ceka`, který se nepřihlásí, dokud mu správce nepřidělí roli.
     */
    googleAutoJoin: integer('google_auto_join', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [uniqueIndex('schools_slug_idx').on(table.slug)],
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    /**
     * Unikátní napříč všemi školami, vždy malými písmeny. Přihlášení tak
     * nepotřebuje, aby si učitelka nejdřív vybrala školu.
     */
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('ucitelka').$type<Role>(),
    /** Prázdné u účtu, který se přihlašuje jedině Googlem. */
    passwordHash: text('password_hash'),
    /** Trvalé id účtu u Googlu (`sub`); prázdné u účtu jen s heslem. */
    googleSub: text('google_sub'),
    status: text('status').notNull().default('aktivni').$type<UserStatus>(),
    /**
     * Zvýšení čísla zneplatní všechny vydané cookie téhle osoby — tím se
     * odhlásí ze všech zařízení, aniž by se muselo měnit společné tajemství.
     */
    sessionVersion: integer('session_version').notNull().default(1),
    /** Po resetu hesla správcem: dokud si nezvolí vlastní, nikam jinam nesmí. */
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    /**
     * Brzda proti zkoušení hesla. Počítadlo v paměti procesu na serverless
     * nestačí — každá instance funkce má svoje, takže se počítá i tady.
     */
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull().default(now),
    createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_google_sub_idx').on(table.googleSub),
    index('users_school_status_idx').on(table.schoolId, table.status),
  ],
)

/**
 * Vydané relace. Cookie sama o sobě jde odvolat jedině vypršením, proto se
 * vedle ní vede řádek: odhlášení jednoho zařízení je pak `revoked_at`, ne
 * změna společného tajemství. Podpis cookie ověří `proxy.ts` bez databáze,
 * tenhle řádek se čte až na serveru.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
    /** Absolutní strop platnosti; cookie sama má kratší klouzavou platnost. */
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
)

/**
 * Záznam událostí pro správce: kdo se přihlásil, kdo co smazal, co spadlo
 * při generování. Je to jediné místo, kde se dá zpětně zjistit „kam se ta
 * témata poděla“ — proto se sem píše i z míst, která jinak mlčí.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull().default(now),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'cascade' }),
    /** Prázdné u událostí bez přihlášení (neúspěšný pokus, běh z plánovače). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    /** Čeho se událost týká (`topic`, `question`, `test`, `user`…). */
    entity: text('entity'),
    entityId: text('entity_id'),
    detail: text('detail', { mode: 'json' }),
    severity: text('severity').notNull().default('info').$type<'info' | 'chyba'>(),
    ip: text('ip'),
  },
  (table) => [
    index('audit_school_at_idx').on(table.schoolId, table.at, table.id),
    index('audit_user_idx').on(table.userId, table.at),
  ],
)

/**
 * Sloupec školy má každá tabulka s obsahem, i když by šla odvodit přes
 * rodiče. Dědění vypadá levněji, ale znamenalo by do každého dotazu nad
 * listem přidat dva joiny — a právě zapomenutý join je ta chyba, kvůli které
 * by jedna učitelka viděla cizí data.
 */
function schoolId() {
  return text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' })
}

/** Kdo záznam založil. Jen evidence; nikdy se podle toho nefiltruje. */
function createdBy() {
  return text('created_by').references(() => users.id, { onDelete: 'set null' })
}

export const subjects = sqliteTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    createdBy: createdBy(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  /** Dvě školy smějí mít každá svůj „PŘÍRODOPIS"; jedna škola dvakrát ne. */
  (table) => [uniqueIndex('subjects_school_name_idx').on(table.schoolId, table.name)],
)

export const grades = sqliteTable(
  'grades',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    createdBy: createdBy(),
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
    schoolId: schoolId(),
    createdBy: createdBy(),
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
  (table) => [
    uniqueIndex('topics_grade_name_idx').on(table.gradeId, table.name),
    index('topics_school_idx').on(table.schoolId),
  ],
)

export const materials = sqliteTable(
  'materials',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** Kdo materiál nahrál; knihovna je společná, tohle je jen evidence. */
    createdBy: createdBy(),
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
    index('materials_school_hash_idx').on(table.schoolId, table.contentHash),
  ],
)

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  schoolId: schoolId(),
  mimeType: text('mime_type').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull().default(now),
})

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** Kdo otázku vytvořil nebo nechal vygenerovat. Banka je společná. */
    createdBy: createdBy(),
    /** Kdo ji naposled schválil nebo zamítl — aby bylo vidět, čí to bylo rozhodnutí. */
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: text('reviewed_at'),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    type: text('type').notNull().$type<QuestionContent['type']>(),
    payload: text('payload', { mode: 'json' }).notNull().$type<QuestionContent['payload']>(),
    blocks: text('blocks', { mode: 'json' }).notNull().default(sql`'[]'`).$type<Block[]>(),
    points: real('points').notNull().default(1),
    difficulty: integer('difficulty').notNull().default(2),
    explanation: text('explanation'),
    source: text('source').notNull().default('ai').$type<'ai' | 'manual'>(),
    /**
     * Výchozí `draft` se v praxi nikdy neuplatní — každý vkládaný řádek
     * (generování i ruční přidání) status nastavuje sám na `approved`.
     * Zůstává jako neškodná záloha, ne jako popis skutečného chování; měnit
     * ho by znamenalo přestavbu tabulky, a k tomu není důvod.
     */
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
     * stavem (bez smazaných, doplňování počtu v `resolveCount`).
     * Nahrazuje dřívější index jen podle tématu — ten je jeho předponou,
     * takže dotazy bez stavu zvládne taky.
     */
    index('questions_topic_status_idx').on(table.topicId, table.status),
    index('questions_material_idx').on(table.materialId),
    index('questions_school_status_idx').on(table.schoolId, table.status),
    index('questions_school_created_by_idx').on(table.schoolId, table.createdBy),
    /**
     * Řazení seznamů a stránkování kurzorem jde vždycky podle dvojice
     * (`created_at`, `id`) — bez indexu se kvůli každé stránce řadila celá
     * banka.
     */
    index('questions_school_created_idx').on(table.schoolId, table.createdAt, table.id),
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
    schoolId: schoolId(),
    /** Hlavolam je soukromý: vidí ho a tiskne jen ta, kdo ho vyrobila. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    /** Seznam hlavolamů je vždycky „moje, od naposled upravených". */
    index('puzzles_owner_idx').on(table.schoolId, table.ownerId, table.updatedAt),
  ],
)

/** Rozpracovaná slovní zásoba podle tématu, aby se nemusela znovu generovat. */
export const puzzleWordDrafts = sqliteTable(
  'puzzle_word_drafts',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<PuzzleContent['kind']>(),
    entries: text('entries', { mode: 'json' }).notNull().$type<PuzzleEntry[]>(),
    model: text('model'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    uniqueIndex('puzzle_word_drafts_owner_topic_kind_idx').on(table.schoolId, table.ownerId, table.topicId, table.kind),
  ],
)

export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /**
     * Kdo úlohu zadal. Fronta podle toho rozděluje pořadí mezi učitelky a
     * běh z plánovače podle toho ví, za koho otázky zapisuje — sezení tam
     * žádné není.
     */
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    index('generation_jobs_school_status_idx').on(table.schoolId, table.status, table.createdAt),
    /** Kolik úloh té které učitelce zrovna běží — podle toho se vybírá další. */
    index('generation_jobs_requester_status_idx').on(table.requestedBy, table.status),
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
    schoolId: schoolId(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    config: text('config', { mode: 'json' }).notNull().$type<TemplateConfig>(),
    builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  /**
   * Vestavěné šablony se každé škole zkopírují, nenechávají se bez školy:
   * SQLite bere v unikátním indexu každé NULL jako jiné, takže by u nich
   * dvojice (škola, slug) nehlídala nic.
   */
  (table) => [uniqueIndex('templates_school_slug_idx').on(table.schoolId, table.slug)],
)

export const tests = sqliteTable(
  'tests',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** Písemka patří té, kdo ji složila; cizí se nezobrazí ani nevytiskne. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * `soukrome` vidí jen autorka, `skola` i kolegyně — když někdo onemocní,
     * musí jít jeho písemku vytisknout, aniž by se skládala znovu.
     */
    visibility: text('visibility').notNull().default('soukrome').$type<'soukrome' | 'skola'>(),
    title: text('title').notNull(),
    description: text('description'),
    /** Test na známky — bez toho se netisknou body ani políčko na známku. */
    graded: integer('graded', { mode: 'boolean' }).notNull().default(true),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id),
    /**
     * Třída, ze které test vznikl. Řídí nabídku témat v editoru a filtr
     * přehledu podle třídy; nepovinné, protože starší testy i ty založené
     * bez konkrétní třídy ho nemají. Smazání ročníku test nesmí vzít s sebou.
     */
    gradeId: text('grade_id').references(() => grades.id, { onDelete: 'set null' }),
    header: text('header', { mode: 'json' }).notNull().$type<TestHeaderConfig>(),
    variants: integer('variants').notNull().default(1),
    showKey: integer('show_key', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [index('tests_owner_idx').on(table.schoolId, table.ownerId, table.updatedAt)],
)

export const testItems = sqliteTable(
  'test_items',
  {
    id: text('id').primaryKey(),
    /**
     * Škola i u položky testu: úklid nepoužitých příloh musí projít zmrazené
     * snímky celé školy (jinak by smazání otázky vzalo obrázek cizí už
     * vytištěné písemce) a nesmí kvůli tomu číst tabulku napříč školami.
     */
    schoolId: schoolId(),
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
    index('test_items_school_idx').on(table.schoolId),
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
export type SchoolRow = typeof schools.$inferSelect
export type UserRow = typeof users.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type AuditRow = typeof auditLog.$inferSelect
