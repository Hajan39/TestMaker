import 'server-only'
import { and, eq, isNull, ne, sum } from 'drizzle-orm'
import {
  containmentSimilarity,
  DUPLICATE_THRESHOLD,
  fileExtension,
  preferredMaterial,
} from '@testmaker/core/extract'
import { db, materials, MIN_USABLE_TOPIC_CHARS, topics } from '@/db'
import { skola, type Scope } from './uzivatel'

interface Candidate {
  id: string
  fileName: string
  text: string
  extension: string
  textLength: number
}

/**
 * Porovná nový materiál s ostatními v témže tématu. Když jde o tentýž obsah
 * v jiném formátu, označí horší z dvojice jako duplicitu — generování pak
 * neběží dvakrát nad stejným textem.
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
    .where(and(skola(scope, materials), eq(materials.id, materialId)))
    .limit(1)
  if (!fresh) return { duplicateOfId: null, score: null }

  const siblings = await db
    .select()
    .from(materials)
    .where(
      and(
        skola(scope, materials),
        eq(materials.topicId, fresh.topicId),
        ne(materials.id, materialId),
        isNull(materials.duplicateOfId),
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

  // Materiály, které dosud ukazovaly na nově odsunutý záznam, přepneme na vítěze.
  await db
    .update(materials)
    .set({ duplicateOfId: keep.id })
    .where(eq(materials.duplicateOfId, drop.id))

  return drop.id === materialId ? { duplicateOfId: keep.id, score: best.score } : { duplicateOfId: null, score: null }
}

/**
 * Přepočítá použitelný objem textu tématu (bez duplicit a bez vynechaných
 * materiálů) a označí témata, na která na písemku nevystačí. Volá se po každé
 * změně materiálů tématu — importu, smazání, vynechání i po označení
 * duplicity, protože se nic z toho do součtu nepočítá.
 */
export async function recomputeTopicContent(scope: Scope, topicId: string): Promise<void> {
  const [row] = await db
    .select({ usableCharCount: sum(materials.charCount) })
    .from(materials)
    .where(
      and(
        skola(scope, materials),
        eq(materials.topicId, topicId),
        isNull(materials.duplicateOfId),
        eq(materials.excluded, false),
      ),
    )

  const usableCharCount = Number(row?.usableCharCount ?? 0)
  await db
    .update(topics)
    .set({ usableCharCount, lowContent: usableCharCount < MIN_USABLE_TOPIC_CHARS })
    .where(and(skola(scope, topics), eq(topics.id, topicId)))
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
