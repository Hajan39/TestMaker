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
  RegenerateReason,
  TemplateConfig,
  TestHeaderConfig,
} from '@testmaker/core/schema'
import type { Role, UserStatus } from '../lib/role'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`

/**
 * The school is the top data boundary: the library, tests and the queue each
 * belong to exactly one. Today there is a single row — but thanks to this
 * table a second school is a row insert, not a migration across the model.
 */
export const schools = sqliteTable(
  'schools',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * Domain of the school's Google accounts (`hd` from sign-in). Empty means
     * Google sign-in is impossible — only accounts with a password.
     */
    googleDomain: text('google_domain'),
    /**
     * What to do with an account from the right domain that is not in the app
     * yet: either reject it and let the manager create it by hand (default),
     * or create an account in the `ceka` state that cannot sign in until the
     * manager assigns a role.
     */
    googleAutoJoin: integer('google_auto_join', { mode: 'boolean' }).notNull().default(false),
    // Address and contacts (`lib/schoolDetails.ts`); all optional.
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    website: text('website'),
    email: text('email'),
    phone: text('phone'),
    /** The school's company ID (ICO). */
    ico: text('ico'),
    /** Name of the principal. */
    principal: text('principal'),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    uniqueIndex('schools_slug_idx').on(table.slug),
    // Google sign-in looks the school up by domain — two schools with the same
    // one would not know where to put the teacher. Several schools without a
    // domain (NULL) are fine.
    uniqueIndex('schools_google_domain_idx').on(table.googleDomain),
  ],
)

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id')
      .notNull()
      .references(() => schools.id, { onDelete: 'cascade' }),
    /**
     * Unique across all schools, always lower case. Sign-in therefore does
     * not need the teacher to pick a school first.
     */
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('ucitelka').$type<Role>(),
    /** Empty for an account that signs in only via Google. */
    passwordHash: text('password_hash'),
    /** Permanent Google account id (`sub`); empty for password-only accounts. */
    googleSub: text('google_sub'),
    status: text('status').notNull().default('aktivni').$type<UserStatus>(),
    /**
     * Bumping the number invalidates all cookies issued to this person — that
     * signs them out everywhere without changing the shared secret.
     */
    sessionVersion: integer('session_version').notNull().default(1),
    /** After a password reset by a manager: until they choose their own, nowhere else. */
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    /**
     * Brake against password guessing. An in-process counter is not enough on
     * serverless — each function instance has its own, so it is counted here too.
     */
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    createdAt: text('created_at').notNull().default(now),
    createdBy: text('created_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    /**
     * The school an administrator switched to in the bar. Empty means the home
     * school (`schoolId`); other roles do not use it. It belongs to the
     * account, not the session, so it works without sign-in too (locally and
     * in tests).
     */
    activeSchoolId: text('active_school_id').references((): AnySQLiteColumn => schools.id, {
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
 * Issued sessions. A cookie alone can only be revoked by expiring, so a row is
 * kept next to it: signing out one device is then `revoked_at`, not a change
 * of the shared secret. `proxy.ts` verifies the cookie signature without the
 * database; this row is read only on the server.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
    /** Absolute lifetime cap; the cookie itself has a shorter sliding lifetime. */
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
 * Event log for managers: who signed in, who deleted what, what failed during
 * generation. It is the only place to find out afterwards "where did those
 * topics go" — so places that are otherwise silent write here too.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull().default(now),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'cascade' }),
    /** Empty for events without sign-in (a failed attempt, a scheduler run). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    /** What the event concerns (`topic`, `question`, `test`, `user`…). */
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
 * Every content table has a school column, even though it could be derived
 * through the parent. Inheriting looks cheaper but would mean adding two joins
 * to every query over a leaf — and a forgotten join is exactly the bug that
 * would let one teacher see someone else's data.
 */
function schoolId() {
  return text('school_id')
    .notNull()
    .references(() => schools.id, { onDelete: 'cascade' })
}

/** Who created the record. Bookkeeping only; never filtered by. */
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
  /** Two schools may each have their own "PŘÍRODOPIS"; one school not twice. */
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
    /** Empty for subjects not split into grades. */
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => [uniqueIndex('grades_subject_name_idx').on(table.subjectId, table.name)],
)

/** Below this many characters of usable text a test reliably cannot be made. */
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
     * Sum of the topic materials' `charCount` without duplicates — kept up to
     * date on every material change (import, deletion, marking a duplicate),
     * so the topic list can rely on it without further queries.
     */
    usableCharCount: integer('usable_char_count').notNull().default(0),
    /** `usableCharCount` below `MIN_USABLE_TOPIC_CHARS` — not enough for a test. */
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
    /** Who uploaded the material; the library is shared, this is just bookkeeping. */
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
     * Filled in when this is another export of the same content (typically a
     * PDF printed from a presentation). Such a material is skipped during
     * generation.
     *
     * The foreign key is `set null` — deleting the original clears the link
     * instead of leaving it dangling and the material silently skipped forever
     * without anyone knowing.
     */
    duplicateOfId: text('duplicate_of_id').references((): AnySQLiteColumn => materials.id, {
      onDelete: 'set null',
    }),
    /** Degree of match with the material in `duplicateOfId` (0–1). */
    duplicateScore: real('duplicate_score'),
    /** The teacher manually excluded the material from generation — the text stays in the library. */
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    /**
     * The same file may be in the library several times — a worksheet is used
     * in both seventh and eighth grade and must be visible in both topics. So
     * only the topic and content pair is unique: it is not imported twice into
     * the same topic.
     */
    uniqueIndex('materials_topic_hash_idx').on(table.topicId, table.contentHash),
    index('materials_topic_idx').on(table.topicId),
    index('materials_duplicate_idx').on(table.duplicateOfId),
    /**
     * Lookup by content alone (import asks "do we know this hash already?"
     * across topics). The composite index above starts with the topic, so it
     * cannot serve this query and importing each file read the whole materials
     * table including texts.
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
    /** Who created the question or had it generated. The bank is shared. */
    createdBy: createdBy(),
    /** Who last approved or rejected it — so it is clear whose decision it was. */
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: text('reviewed_at'),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    materialId: text('material_id').references(() => materials.id, { onDelete: 'set null' }),
    /**
     * The root question this one was derived from as an easier or harder
     * version. `null` for the root and for questions without versions.
     * Deleting the root does not take the version with it — it only loses the
     * link (`set null`), the version itself stays in the bank.
     */
    variantOf: text('variant_of').references((): AnySQLiteColumn => questions.id, { onDelete: 'set null' }),
    type: text('type').notNull().$type<QuestionContent['type']>(),
    payload: text('payload', { mode: 'json' }).notNull().$type<QuestionContent['payload']>(),
    blocks: text('blocks', { mode: 'json' }).notNull().default(sql`'[]'`).$type<Block[]>(),
    points: real('points').notNull().default(1),
    difficulty: integer('difficulty').notNull().default(2),
    explanation: text('explanation'),
    source: text('source').notNull().default('ai').$type<'ai' | 'manual'>(),
    /**
     * The `draft` default never applies in practice — every inserted row
     * (generation and manual addition) sets the status to `approved` itself.
     * It remains as a harmless fallback, not a description of real behaviour;
     * changing it would mean rebuilding the table, and there is no reason to.
     */
    status: text('status').notNull().default('draft').$type<'draft' | 'approved' | 'rejected'>(),
    createdAt: text('created_at').notNull().default(now),
    /** The file the question came from. */
    sourceFile: text('source_file'),
    /** The passage of the material the correct answer relies on. */
    sourceQuote: text('source_quote'),
    /**
     * The model that generated the question (`google:gemini-flash-latest`).
     * Only for later quality comparison when several models of the ladder
     * took turns in one topic — it is shown nowhere in the UI, the teacher
     * does not care. Empty for hand-written questions and everything older.
     */
    model: text('model'),
    /**
     * Question text (prompt, options, answers and explanation) in lower case —
     * only for searching the bank. Without it searching would happen in the
     * browser over everything downloaded, and the whole bank would have to be
     * sent for that.
     *
     * Filled on every question write (`searchTextFor` in `lib/questions.ts`)
     * and lower-cased in JavaScript so Czech letters with diacritics behave
     * like the rest — SQLite's `lower()` only handles ASCII.
     */
    searchText: text('search_text').notNull().default(''),
  },
  (table) => [
    /**
     * The most frequent query in the app: questions of one topic, usually
     * narrowed by status (without deleted ones, count completion in
     * `resolveCount`). Replaces the former topic-only index — that one is its
     * prefix, so queries without status are covered too.
     */
    index('questions_topic_status_idx').on(table.topicId, table.status),
    index('questions_material_idx').on(table.materialId),
    /** All versions of a root question — the question card offers them together. */
    index('questions_variant_of_idx').on(table.variantOf),
    index('questions_school_status_idx').on(table.schoolId, table.status),
    index('questions_school_created_by_idx').on(table.schoolId, table.createdBy),
    /**
     * List sorting and cursor pagination always go by the (`created_at`, `id`)
     * pair — without an index the whole bank was sorted for every page.
     */
    index('questions_school_created_idx').on(table.schoolId, table.createdAt, table.id),
  ],
)

/**
 * Feedback from regenerating a question with the model: why the teacher
 * discarded the replaced question (or without a reason, with one click) and
 * which model created it. Created on every replacement, even without a
 * reason — otherwise it would be impossible to compute what share of each
 * model's questions teachers end up regenerating.
 */
export const questionFeedback = sqliteTable(
  'question_feedback',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** The replaced question. Deleting the question keeps the record, only the link is lost. */
    questionId: text('question_id').references(() => questions.id, { onDelete: 'set null' }),
    /** The question that replaced it. */
    replacementId: text('replacement_id').references(() => questions.id, { onDelete: 'set null' }),
    /** The model that generated the replaced question — empty for older questions without a model. */
    model: text('model'),
    reason: text('reason').$type<RegenerateReason>(),
    note: text('note'),
    createdBy: createdBy(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [index('question_feedback_school_idx').on(table.schoolId, table.createdAt)],
)

/**
 * A rule a school uses to extend the question generation prompt itself. It is
 * created explicitly — a manager in Management turns a recurring regeneration
 * reason into a rule (prefilled from its hint, editable); nothing gets into
 * the prompt on its own. At most ten may be active (`MAX_ACTIVE_PROMPT_RULES`
 * in `lib/promptRules.ts`) — otherwise one school that only collects rules and
 * never disables them would bloat the prompt.
 */
export const promptRules = sqliteTable(
  'prompt_rules',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** Max. 300 characters — enforced by `lib/promptRules.ts`, not the database. */
    text: text('text').notNull(),
    /** The regeneration reason the rule came from; a manual rule has none. */
    reason: text('reason').$type<RegenerateReason>(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdBy: createdBy(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [index('prompt_rules_school_idx').on(table.schoolId, table.active)],
)

/**
 * Puzzles (word search, cryptogram). A table of their own, not another
 * question type: a puzzle has no answer or points, is not generated into the
 * bank and the teacher looks for it elsewhere than questions. It goes into a
 * test as a test item (`test_items` of kind `puzzle`) carrying a frozen
 * snapshot — just like a question.
 */
export const puzzles = sqliteTable(
  'puzzles',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** A puzzle is private: only the one who made it sees and prints it. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** A puzzle is made from a topic's materials; it stays without a topic after it is deleted. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    kind: text('kind').notNull().$type<PuzzleContent['kind']>(),
    title: text('title').notNull(),
    instructions: text('instructions').notNull().default(''),
    /** Word + hint pairs; code builds the grid from them, not the database. */
    entries: text('entries', { mode: 'json' }).notNull().$type<PuzzleEntry[]>(),
    /** Kind-specific settings: grid size and seed, or the hidden phrase. */
    payload: text('payload', { mode: 'json' }).notNull().$type<PuzzleContent['payload']>(),
    /** The model that supplied the vocabulary; empty for hand-written puzzles. */
    model: text('model'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    index('puzzles_topic_idx').on(table.topicId),
    /** The puzzle list is always "mine, most recently edited first". */
    index('puzzles_owner_idx').on(table.schoolId, table.ownerId, table.updatedAt),
  ],
)

/** Vocabulary in progress per topic, so it need not be generated again. */
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
     * Who requested the job. The queue uses it to share the order among
     * teachers and a scheduler run uses it to know whom it writes questions
     * for — there is no session there.
     */
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Generation always uses the whole group of materials, i.e. the topic. */
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
    /** How many jobs each teacher has running — the next one is picked by this. */
    index('generation_jobs_requester_status_idx').on(table.requestedBy, table.status),
    /**
     * Topic reservation (`claimTopic`, `isTopicBusy`) and queueing ask for the
     * topic and status pair. A status-only index is not enough: there are few
     * queued and running jobs, but finished ones keep piling up forever.
     */
    index('generation_jobs_topic_status_idx').on(table.topicId, table.status),
  ],
)

export interface GenerationJobParams {
  count: number
  types: QuestionContent['type'][]
  difficulty: 1 | 2 | 3 | 'mix'
  /** `add` = this many new questions, `target` = top the topic up to this count. */
  mode?: 'add' | 'target'
  /**
   * A topic claim of a direct generation (`claimTopic`), not a queue job. When
   * the server cuts it off it fails; a queue job goes back to the queue instead.
   */
  direct?: boolean
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
   * Built-in templates are copied to each school, not left without one:
   * SQLite treats every NULL in a unique index as distinct, so the
   * (school, slug) pair would guard nothing for them.
   */
  (table) => [uniqueIndex('templates_school_slug_idx').on(table.schoolId, table.slug)],
)

export const tests = sqliteTable(
  'tests',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** A test belongs to whoever composed it; others' tests are neither shown nor printed. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * `soukrome` is visible only to the author, `skola` to colleagues too —
     * when someone falls ill, their test must be printable without composing
     * it again.
     */
    visibility: text('visibility').notNull().default('soukrome').$type<'soukrome' | 'skola'>(),
    /**
     * A test or a worksheet. A worksheet shares the editor, templates and
     * printing with tests, but has its own tab and always prints without
     * points and a grade.
     */
    kind: text('kind').notNull().default('pisemka').$type<'pisemka' | 'pracovni_list'>(),
    title: text('title').notNull(),
    description: text('description'),
    /**
     * The library topic the worksheet was made for. Empty for tests and for
     * worksheets from a free brief; deleting the topic must not take the
     * worksheet with it.
     */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    /**
     * The worksheet brief as the teacher wrote it, including pasted text of
     * her own. Regenerating individual pieces starts from it so they stay in
     * the spirit of the worksheet.
     */
    brief: text('brief'),
    /** A graded test — without it neither points nor a grade box are printed. */
    graded: integer('graded', { mode: 'boolean' }).notNull().default(true),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id),
    /**
     * The class the test was made from. Drives the topic choice in the editor
     * and the overview filter by class; optional, because older tests and
     * those created without a specific class lack it. Deleting the grade must
     * not take the test with it.
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
     * School on test items too: cleaning up unused attachments must go through
     * the frozen snapshots of the whole school (otherwise deleting a question
     * would take an image from someone else's already printed test) and must
     * not read the table across schools to do so.
     */
    schoolId: schoolId(),
    testId: text('test_id')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind')
      .notNull()
      .$type<'question' | 'heading' | 'instruction' | 'page_break' | 'puzzle' | 'text' | 'table'>(),
    /**
     * Link to the question bank. The foreign key is `set null`: deleting a
     * question must not make the item vanish from a finished test — what is
     * on paper is held by `questionSnapshot`, the link only serves comparison
     * with the bank.
     */
    questionId: text('question_id').references(() => questions.id, { onDelete: 'set null' }),
    text: text('text'),
    pointsOverride: real('points_override'),
    /**
     * Override of the answer line count for this question in this test. How
     * much space a pupil needs depends on the test, not the question — an
     * end-of-year review needs more space for the same question than a short
     * ten-minute quiz. Empty = whatever the question itself has.
     */
    linesOverride: integer('lines_override'),
    /** The word bank of a fill-in-the-blank question is not printed in this test. */
    wordBankHidden: integer('word_bank_hidden', { mode: 'boolean' }).notNull().default(false),
    /**
     * Frozen question content (JSON per `questionSnapshotSchema`) as it was
     * when the question was added to the test. Rendering, preview and key read
     * from here — otherwise a later edit of the question would silently
     * rewrite an already printed test and the key would not match. Empty for
     * tests created before snapshots were introduced.
     */
    questionSnapshot: text('question_snapshot'),
    /**
     * Link to the puzzle for an item of kind `puzzle`. The foreign key is
     * `set null` for the same reason as for questions: deleting a puzzle from
     * the library must not change a finished test — what is on paper is held
     * by `puzzleSnapshot`.
     */
    puzzleId: text('puzzle_id').references(() => puzzles.id, { onDelete: 'set null' }),
    /** Frozen puzzle content (JSON per `puzzleContentSchema`). */
    puzzleSnapshot: text('puzzle_snapshot'),
    /**
     * Item content that does not fit into `text`: for `text` the variant (text
     * or fun fact), for `table` the grid. The shape is defined by zod in core.
     */
    content: text('content', { mode: 'json' }).$type<Record<string, unknown>>(),
    /** "Verify" flag: the content does not come from the topic materials but from the model's general knowledge. */
    needsCheck: integer('needs_check', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('test_items_test_idx').on(table.testId, table.position),
    /**
     * The foreign key is `set null`: on every question deletion SQLite must
     * find the test items pointing to it. Without an index it scans the whole
     * table including the frozen question snapshots.
     */
    index('test_items_question_idx').on(table.questionId),
    /** Same reason as for questions: `set null` must find items without reading the whole table. */
    index('test_items_puzzle_idx').on(table.puzzleId),
    index('test_items_school_idx').on(table.schoolId),
  ],
)

/**
 * Every attempt to call a model — including the one that hit a limit and the
 * ladder moved on. An operational record for the administration overview; it
 * does not belong in the school backup.
 */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    schoolId: schoolId(),
    /** Empty for the queue and the scheduler, where nobody is signed in. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    task: text('task').notNull().$type<'otazky' | 'hlavolam' | 'list' | 'prepis'>(),
    /** `provider:model` */
    model: text('model').notNull(),
    outcome: text('outcome').notNull().$type<'ok' | 'limit' | 'bad_shape' | 'error'>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    index('ai_calls_created_idx').on(table.createdAt),
    index('ai_calls_school_idx').on(table.schoolId, table.createdAt),
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
export type PromptRuleRow = typeof promptRules.$inferSelect
export type AiCallRow = typeof aiCalls.$inferSelect
