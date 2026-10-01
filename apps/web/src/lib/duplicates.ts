import 'server-only'
import { and, eq, isNull, ne, sum } from 'drizzle-orm'
import {
  containmentSimilarity,
  DUPLICATE_THRESHOLD,
  fileExtension,
  preferredMaterial,
} from '@testmaker/core/extract'
import { db, materials, MIN_USABLE_TOPIC_CHARS, topics } from '@/db'
import { inSchool, type Scope } from './user'

interface Candidate {
  id: string
  fileName: string
  text: string
  extension: string
  textLength: number
}

/**
 * Compares a new material with the others in the same topic. When it is the
 * same content in another format, marks the worse of the pair as a duplicate —
 * so generation doesn't run twice over the same text.
 */
export async function linkDuplicates(
  scope: Scope,
  materialId: string,
): Promise<{
  duplicateOfId: string | null
  score: number | null
}> {
  const [fresh] = await db
    .select()
    .from(materials)
    .where(and(inSchool(scope, materials), eq(materials.id, materialId)))
    .limit(1)
  if (!fresh) return { duplicateOfId: null, score: null }

  // A manually excluded material must not win as the "kept original" —
  // otherwise uploading a better version (say a PDF instead of an excluded
  // presentation) would mark the new one as a duplicate of the excluded one,
  // leaving both unusable in the topic.
  const siblings = await db
    .select()
    .from(materials)
    .where(
      and(
        inSchool(scope, materials),
        eq(materials.topicId, fresh.topicId),
        ne(materials.id, materialId),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )

  const incoming: Candidate = toCandidate(fresh)
  let best: { candidate: Candidate; score: number } | null = null

  for (const sibling of siblings) {
    const score = containmentSimilarity(fresh.text, sibling.text)
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { candidate: toCandidate(sibling), score }
    }
  }

  if (!best) return { duplicateOfId: null, score: null }

  const keep = preferredMaterial(incoming, best.candidate)
  const drop = keep === incoming ? best.candidate : incoming

  await db
    .update(materials)
    .set({ duplicateOfId: keep.id, duplicateScore: best.score })
    .where(eq(materials.id, drop.id))

  // Materials that pointed at the newly demoted record are switched to the winner.
  await db
    .update(materials)
    .set({ duplicateOfId: keep.id })
    .where(eq(materials.duplicateOfId, drop.id))

  return drop.id === materialId ? { duplicateOfId: keep.id, score: best.score } : { duplicateOfId: null, score: null }
}

/**
 * Recomputes the topic's usable text volume (without duplicates and excluded
 * materials) and flags topics with too little for a test. Called after every
 * change to the topic's materials — import, delete, exclude and duplicate
 * marking, since none of those count toward the sum.
 */
export async function recomputeTopicContent(scope: Scope, topicId: string): Promise<void> {
  const [row] = await db
    .select({ usableCharCount: sum(materials.charCount) })
    .from(materials)
    .where(
      and(
        inSchool(scope, materials),
        eq(materials.topicId, topicId),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )

  const usableCharCount = Number(row?.usableCharCount ?? 0)
  await db
    .update(topics)
    .set({ usableCharCount, lowContent: usableCharCount < MIN_USABLE_TOPIC_CHARS })
    .where(and(inSchool(scope, topics), eq(topics.id, topicId)))
}

function toCandidate(row: typeof materials.$inferSelect): Candidate {
  return {
    id: row.id,
    fileName: row.fileName,
    text: row.text,
    extension: fileExtension(row.fileName),
    textLength: row.charCount,
  }
}
