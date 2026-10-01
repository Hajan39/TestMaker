import { importBatchSchema } from '@testmaker/core/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, materials, topics } from '@/db'
import { newId } from '@/lib/ids'
import { linkDuplicates, recomputeTopicContent } from '@/lib/duplicates'
import { ensureTopic } from '@/lib/library'
import { inSchool, withScope } from '@/lib/user'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

/** Accepts a batch of materials with already extracted text (binaries are never sent). */
export async function POST(request: Request) {
  return withScope(async (account) => {
  const parsed = importBatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
  }

  // Upload from a specific topic: the subject/grade/topic fields are ignored
  // and materials always go into this topic by id, not by names — those may
  // have been renamed in the meantime.
  let fixedTopicId: string | null = null
  if (parsed.data.topicId) {
    const [topic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(inSchool(account, topics), eq(topics.id, parsed.data.topicId)))
      .limit(1)
    if (!topic) return NextResponse.json({ error: t('library:questionFile.topicNotFound') }, { status: 404 })
    fixedTopicId = topic.id
  }

  const groupMaterials = new URL(request.url).searchParams.get('group') !== '0'
  const hashes = parsed.data.materials.map((m) => m.contentHash)
  const relativePaths = parsed.data.materials.map((m) => m.relativePath)

  // The same content may be in the library several times, just not twice in
  // one topic — a worksheet for both grade 7 and grade 8 belongs to both topics.
  // So known materials are tracked per (topic, content) pair, not by content alone.
  const existing = await db
    .select({ hash: materials.contentHash, topicId: materials.topicId })
    .from(materials)
    .where(and(inSchool(account, materials), inArray(materials.contentHash, hashes)))
  const known = new Set(existing.map((row) => knownKey(row.topicId, row.hash)))

  // The relative path identifies a repeated import of the same file. When its
  // content changed since last time (different hash), the old version is
  // replaced so the topic doesn't keep both and generate from them twice.
  //
  // When uploading into a specific topic the relative path is just the file
  // name (no folder structure), so an equally named file in another topic is
  // normal — the search for a prior version is limited to this topic, so an
  // upload into topic B doesn't delete or rename materials in topic A.
  const priorByPath = new Map(
    (
      await db
        .select({
          id: materials.id,
          relativePath: materials.relativePath,
          contentHash: materials.contentHash,
          topicId: materials.topicId,
          excluded: materials.excluded,
        })
        .from(materials)
        .where(
          fixedTopicId
            ? and(inSchool(account, materials), eq(materials.topicId, fixedTopicId), inArray(materials.relativePath, relativePaths))
            : and(inSchool(account, materials), inArray(materials.relativePath, relativePaths)),
        )
    ).map((row) => [row.relativePath, row]),
  )

  let imported = 0
  let duplicates = 0
  let sameContent = 0
  let replaced = 0
  const touchedTopics = new Set<string>()

  for (const material of parsed.data.materials) {
    const prior = priorByPath.get(material.relativePath)
    if (prior && prior.contentHash === material.contentHash) {
      // Same file with the same content — nothing changed.
      duplicates += 1
      continue
    }

    // The topic is resolved before the duplicate decision: the same content in
    // another topic is a legitimate new material, not a duplicate.
    const topicId =
      fixedTopicId ??
      (await ensureTopic(account, {
        subject: material.subject,
        grade: material.grade,
        topic: material.topic,
        group: groupMaterials,
      }))

    if (prior) {
      // A file at this path was imported before, but with different content —
      // the old version is replaced so the topic doesn't keep both.
      await db.delete(materials).where(and(inSchool(account, materials), eq(materials.id, prior.id)))
      known.delete(knownKey(prior.topicId, prior.contentHash))
      priorByPath.delete(material.relativePath)
      touchedTopics.add(prior.topicId)
      replaced += 1
    }

    if (known.has(knownKey(topicId, material.contentHash))) {
      // The same content is already in this topic (maybe under another file name).
      duplicates += 1
      continue
    }

    const id = newId()
    await db.insert(materials).values({
      id,
      schoolId: account.schoolId,
      createdBy: account.userId,
      topicId,
      fileName: material.fileName,
      relativePath: material.relativePath,
      mimeType: material.mimeType,
      sizeBytes: material.sizeBytes,
      text: material.text,
      charCount: material.text.length,
      pageCount: material.pageCount,
      needsOcr: material.needsOcr,
      contentHash: material.contentHash,
      // Uploading a new version of a file the teacher manually excluded keeps
      // the exclusion — otherwise the changed file would silently return to
      // generation without her deciding again.
      excluded: prior?.excluded ?? false,
    })
    known.add(knownKey(topicId, material.contentHash))
    touchedTopics.add(topicId)
    imported += 1

    // Mark the same content in another format (a PDF printed from a
    // presentation) so the same questions aren't generated from it twice.
    const link = await linkDuplicates(account, id)
    if (link.duplicateOfId) sameContent += 1
  }

  for (const topicId of touchedTopics) await recomputeTopicContent(account, topicId)

  return NextResponse.json({ imported, duplicates, sameContent, replaced })
  }, { write: true })
}

/** Deletes a material and the questions made from it (the foreign key is `set null`, hence the manual delete). */
export async function DELETE(request: Request) {
  return withScope(
    async (account) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return NextResponse.json({ error: t('api:invalidRequest') }, { status: 400 })
      const [row] = await db
        .select({ topicId: materials.topicId })
        .from(materials)
        .where(and(inSchool(account, materials), eq(materials.id, id)))
        .limit(1)
      await db.delete(materials).where(and(inSchool(account, materials), eq(materials.id, id)))
      // Materials pointing at the deleted one as a duplicate are handled by the
      // foreign key (`set null`) — here we only recompute the topic's usable text.
      if (row) await recomputeTopicContent(account, row.topicId)
      return NextResponse.json({ ok: true })
    },
    { write: true },
  )
}

const excludeSchema = z.object({ id: z.string().min(1), excluded: z.boolean() })

/** Excludes a material from question generation (or brings it back). */
export async function PATCH(request: Request) {
  return withScope(
    async (account) => {
      const parsed = excludeSchema.safeParse(await request.json())
      if (!parsed.success) {
        return NextResponse.json({ error: t('api:invalidRequest'), detail: parsed.error.issues }, { status: 400 })
      }

      const [row] = await db
        .select({ topicId: materials.topicId })
        .from(materials)
        .where(and(inSchool(account, materials), eq(materials.id, parsed.data.id)))
        .limit(1)
      if (!row) return NextResponse.json({ error: t('library:materialsApi.materialGone') }, { status: 404 })

      await db
        .update(materials)
        .set({ excluded: parsed.data.excluded })
        .where(and(inSchool(account, materials), eq(materials.id, parsed.data.id)))
      // An excluded material stops counting toward the topic's usable text,
      // so it must be recomputed just like after a delete.
      await recomputeTopicContent(account, row.topicId)

      return NextResponse.json({ ok: true })
    },
    { write: true },
  )
}

/** Key for tracking known materials: the same content in the same topic. */
function knownKey(topicId: string, contentHash: string): string {
  return `${topicId}\n${contentHash}`
}
