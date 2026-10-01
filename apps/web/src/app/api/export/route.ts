import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { db } from '@/db'
import {
  BackupRowError,
  FORMAT,
  VERSION,
  isTableName,
  backupFileName,
  backupChunks,
  writeSelfReferences,
  writeRows,
} from '@/lib/backup'
import { MANAGEMENT_ROLES } from '@/lib/role'
import { withScope, writeAudit } from '@/lib/user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Backup of the whole library into one JSON file.
 *
 * The response streams out (`ReadableStream`), not as one finished string:
 * a streamed response is not subject to the 4.5 MB per-request cap because it
 * never sits whole in the function's memory. Today's library exceeds 3 MB
 * and keeps growing.
 */
export async function GET() {
  return withScope(
    async (account) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of backupChunks(db, { schoolId: account.schoolId })) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      } catch (error) {
        // The file is already downloading, so the error cannot be sent as a
        // status code — the only option is to abort the connection so no
        // truncated JSON arises that could be restored as if it were fine.
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${backupFileName()}"`,
      'cache-control': 'no-store',
    },
  })
    },
    // The backup is the whole school: it belongs to the manager, not a single teacher.
    { role: MANAGEMENT_ROLES },
  )
}

const batchSchema = z.union([
  z.object({
    table: z.string(),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    table: z.literal('materials'),
    links: z.array(
      z.object({
        id: z.string().min(1),
        duplicateOfId: z.string().min(1),
        duplicateScore: z.number().nullable().default(null),
      }),
    ),
  }),
  // A question version points to its root; like material duplicates it is
  // written once all questions are in the target.
  z.object({
    table: z.literal('questions'),
    links: z.array(
      z.object({
        id: z.string().min(1),
        variantOf: z.string().min(1),
      }),
    ),
  }),
])

/**
 * Restore from backup — in batches.
 *
 * Unlike downloading, uploading is subject to the 4.5 MB per-request cap, so
 * the browser slices the file (`lib/backupClient.ts`) and sends it here table
 * by table, batch by batch. The client keeps the batch order; this only writes.
 *
 * Merging is by `id` (`on conflict do update`) and nothing is deleted: a
 * restore into a non-empty library is a top-up, not a swap. The same file can
 * be uploaded twice and nothing is duplicated the second time.
 */
export async function POST(request: Request) {
  return withScope(
    async (account) => {
  const parsed = batchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { error: t('backup:errors.notBackupRequest', { format: FORMAT, version: VERSION }) },
      { status: 400 },
    )
  }

  const batch = parsed.data
  if (!isTableName(batch.table)) {
    return Response.json({ error: t('backup:errors.unknownTable', { table: batch.table }) }, { status: 400 })
  }

  try {
    if ('links' in batch) {
      const written = await writeSelfReferences(db, batch.links, { schoolId: account.schoolId })
      await writeAudit({
        schoolId: account.schoolId,
        userId: account.userId,
        action: 'obnova-ze-zalohy',
        entity: batch.table,
        detail: { odkazy: written },
      })
      return Response.json({ ok: true, table: batch.table, written })
    }

    const result = await writeRows(db, batch.table, batch.rows, {
      schoolId: account.schoolId,
      userId: account.userId,
    })
    return Response.json({
      ok: true,
      table: batch.table,
      written: result.written,
      links: result.links,
    })
  } catch (error) {
    // Typically a missing parent (a topic without a subject) or a file from a
    // newer app version. The teacher is not helped by an SQLite message but by
    // where exactly the restore got stuck. Explanations from `lib/backup`
    // (`BackupRowError`) pass through; anything else is a technical detail
    // that goes only to the server log.
    const explained = error instanceof BackupRowError
    if (!explained) console.error(`Restore from backup: table ${batch.table}`, error)
    return Response.json(
      {
        error: explained ? error.message : t('backup:errors.batchFailed', { table: batch.table }),
      },
      { status: 400 },
    )
  }
    },
    { role: MANAGEMENT_ROLES },
  )
}
