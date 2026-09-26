import { importBatchSchema } from '@testmaker/core/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, materials, topics } from '@/db'
import { newId } from '@/lib/ids'
import { linkDuplicates, recomputeTopicContent } from '@/lib/duplicates'
import { ensureTopic } from '@/lib/library'
import { skola, sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Přijme dávku materiálů s už extrahovaným textem (binárky se neposílají). */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
  const parsed = importBatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  // Nahrání z konkrétního tématu: pole subject/grade/topic se ignorují a
  // materiály jdou vždycky do tohohle tématu podle id, ne podle jmen —
  // ta se mezitím mohla přejmenovat.
  let fixedTopicId: string | null = null
  if (parsed.data.topicId) {
    const [topic] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(skola(ucet, topics), eq(topics.id, parsed.data.topicId)))
      .limit(1)
    if (!topic) return NextResponse.json({ error: 'Téma se nenašlo' }, { status: 404 })
    fixedTopicId = topic.id
  }

  const groupMaterials = new URL(request.url).searchParams.get('group') !== '0'
  const hashes = parsed.data.materials.map((m) => m.contentHash)
  const relativePaths = parsed.data.materials.map((m) => m.relativePath)

  // Tentýž obsah smí být v knihovně vícekrát, jen ne dvakrát v jednom tématu —
  // pracovní list ze sedmého i osmého ročníku patří do obou témat. Proto se
  // už známé materiály evidují po dvojici (téma, obsah), ne jen podle obsahu.
  const existing = await db
    .select({ hash: materials.contentHash, topicId: materials.topicId })
    .from(materials)
    .where(and(skola(ucet, materials), inArray(materials.contentHash, hashes)))
  const known = new Set(existing.map((row) => knownKey(row.topicId, row.hash)))

  // Podle relativní cesty poznáme opakovaný import téhož souboru. Když se
  // od minula změnil obsah (jiný hash), stará verze se nahradí novou, ať v
  // tématu nezůstávají obě a negeneruje se z nich dvakrát.
  const priorByPath = new Map(
    (
      await db
        .select({ id: materials.id, relativePath: materials.relativePath, contentHash: materials.contentHash, topicId: materials.topicId })
        .from(materials)
        .where(and(skola(ucet, materials), inArray(materials.relativePath, relativePaths)))
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

    // Téma známe ještě před rozhodnutím o duplicitě: tentýž obsah v jiném
    // tématu je legitimní nový materiál, ne duplicita.
    const topicId =
      fixedTopicId ??
      (await ensureTopic(ucet, {
        subject: material.subject,
        grade: material.grade,
        topic: material.topic,
        group: groupMaterials,
      }))

    if (prior) {
      // Soubor na této cestě byl už dřív importovaný, ale s jiným obsahem —
      // nahrazujeme starou verzi, aby v tématu nezůstaly obě.
      await db.delete(materials).where(and(skola(ucet, materials), eq(materials.id, prior.id)))
      known.delete(knownKey(prior.topicId, prior.contentHash))
      priorByPath.delete(material.relativePath)
      touchedTopics.add(prior.topicId)
      replaced += 1
    }

    if (known.has(knownKey(topicId, material.contentHash))) {
      // Tentýž obsah už v tomhle tématu je (třeba pod jiným názvem souboru).
      duplicates += 1
      continue
    }

    const id = newId()
    await db.insert(materials).values({
      id,
      schoolId: ucet.schoolId,
      createdBy: ucet.userId,
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
    known.add(knownKey(topicId, material.contentHash))
    touchedTopics.add(topicId)
    imported += 1

    // Stejný obsah v jiném formátu (PDF vytištěné z prezentace) označíme,
    // ať se z něj negenerují tytéž otázky podruhé.
    const link = await linkDuplicates(ucet, id)
    if (link.duplicateOfId) sameContent += 1
  }

  for (const topicId of touchedTopics) await recomputeTopicContent(ucet, topicId)

  return NextResponse.json({ imported, duplicates, sameContent, replaced })
  }, { zapis: true })
}

/** Smaže materiál i otázky, které z něj vznikly (cizí klíč je `set null`, proto mažeme ručně). */
export async function DELETE(request: Request) {
  return sRozsahem(
    async (ucet) => {
      const id = new URL(request.url).searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'Chybí id' }, { status: 400 })
      const [row] = await db
        .select({ topicId: materials.topicId })
        .from(materials)
        .where(and(skola(ucet, materials), eq(materials.id, id)))
        .limit(1)
      await db.delete(materials).where(and(skola(ucet, materials), eq(materials.id, id)))
      // Materiály, které na smazaný ukazovaly jako na duplicitu, řeší cizí klíč
      // (`set null`) sám — tady jen přepočítáme použitelný objem textu tématu.
      if (row) await recomputeTopicContent(ucet, row.topicId)
      return NextResponse.json({ ok: true })
    },
    { zapis: true },
  )
}

/** Klíč pro evidenci už známých materiálů: tentýž obsah v témže tématu. */
function knownKey(topicId: string, contentHash: string): string {
  return `${topicId}\n${contentHash}`
}
