import { importBatchSchema } from '@testmaker/core/schema'
import { eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, materials } from '@/db'
import { newId } from '@/lib/ids'
import { linkDuplicates } from '@/lib/duplicates'
import { ensureTopic } from '@/lib/library'

export const runtime = 'nodejs'

/** Přijme dávku materiálů s už extrahovaným textem (binárky se neposílají). */
export async function POST(request: Request) {
  const parsed = importBatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const hashes = parsed.data.materials.map((m) => m.contentHash)
  const existing = await db
    .select({ hash: materials.contentHash })
    .from(materials)
    .where(inArray(materials.contentHash, hashes))
  const known = new Set(existing.map((row) => row.hash))

  let imported = 0
  let duplicates = 0
  let sameContent = 0

  for (const material of parsed.data.materials) {
    if (known.has(material.contentHash)) {
      duplicates += 1
      continue
    }
    const id = newId()
    const topicId = await ensureTopic({
      subject: material.subject,
      grade: material.grade,
      topic: material.topic,
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
    imported += 1

    // Stejný obsah v jiném formátu (PDF vytištěné z prezentace) označíme,
    // ať se z něj negenerují tytéž otázky podruhé.
    const link = await linkDuplicates(id)
    if (link.duplicateOfId) sameContent += 1
  }

  return NextResponse.json({ imported, duplicates, sameContent })
}

/** Smaže materiál i otázky, které z něj vznikly (cizí klíč je `set null`, proto mažeme ručně). */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Chybí id' }, { status: 400 })
  await db.delete(materials).where(eq(materials.id, id))
  return NextResponse.json({ ok: true })
}
