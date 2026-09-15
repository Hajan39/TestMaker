import { importBatchSchema } from '@testmaker/core/schema'
import { eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, materials } from '@/db'
import { newId } from '@/lib/ids'
import { linkDuplicates, recomputeTopicContent } from '@/lib/duplicates'
import { ensureTopic } from '@/lib/library'

export const runtime = 'nodejs'

/** Přijme dávku materiálů s už extrahovaným textem (binárky se neposílají). */
export async function POST(request: Request) {
  const parsed = importBatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const groupMaterials = new URL(request.url).searchParams.get('group') !== '0'
  const hashes = parsed.data.materials.map((m) => m.contentHash)
  const relativePaths = parsed.data.materials.map((m) => m.relativePath)

  const existing = await db
    .select({ hash: materials.contentHash })
    .from(materials)
    .where(inArray(materials.contentHash, hashes))
  const known = new Set(existing.map((row) => row.hash))

  // Podle relativní cesty poznáme opakovaný import téhož souboru. Když se
  // od minula změnil obsah (jiný hash), stará verze se nahradí novou, ať v
  // tématu nezůstávají obě a negeneruje se z nich dvakrát.
  const priorByPath = new Map(
    (
      await db
        .select({ id: materials.id, relativePath: materials.relativePath, contentHash: materials.contentHash, topicId: materials.topicId })
        .from(materials)
        .where(inArray(materials.relativePath, relativePaths))
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
      // Stejný soubor se stejným obsahem — nic se nezměnilo.
      duplicates += 1
      continue
    }
    if (prior) {
      // Soubor na této cestě byl už dřív importovaný, ale s jiným obsahem —
      // nahrazujeme starou verzi, aby v tématu nezůstaly obě.
      await db.delete(materials).where(eq(materials.id, prior.id))
      known.delete(prior.contentHash)
      priorByPath.delete(material.relativePath)
      touchedTopics.add(prior.topicId)
      replaced += 1
    } else if (known.has(material.contentHash)) {
      duplicates += 1
      continue
    }

    const id = newId()
    const topicId = await ensureTopic({
      subject: material.subject,
      grade: material.grade,
      topic: material.topic,
      group: groupMaterials,
    })
    await db.insert(materials).values({
      id,
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
    })
    known.add(material.contentHash)
    touchedTopics.add(topicId)
    imported += 1

    // Stejný obsah v jiném formátu (PDF vytištěné z prezentace) označíme,
    // ať se z něj negenerují tytéž otázky podruhé.
    const link = await linkDuplicates(id)
    if (link.duplicateOfId) sameContent += 1
  }

  for (const topicId of touchedTopics) await recomputeTopicContent(topicId)

  return NextResponse.json({ imported, duplicates, sameContent, replaced })
}

/** Smaže materiál i otázky, které z něj vznikly (cizí klíč je `set null`, proto mažeme ručně). */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Chybí id' }, { status: 400 })
  const [row] = await db.select({ topicId: materials.topicId }).from(materials).where(eq(materials.id, id)).limit(1)
  await db.delete(materials).where(eq(materials.id, id))
  // Materiály, které na smazaný ukazovaly jako na duplicitu, řeší cizí klíč
  // (`set null`) sám — tady jen přepočítáme použitelný objem textu tématu.
  if (row) await recomputeTopicContent(row.topicId)
  return NextResponse.json({ ok: true })
}
