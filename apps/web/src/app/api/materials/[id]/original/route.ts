import { get, head } from '@vercel/blob'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { and, eq } from 'drizzle-orm'
import { t } from '@testmaker/core/i18n'
import { db, materials } from '@/db'
import { MAX_ORIGINAL_BYTES } from '@/lib/materials'
import {
  attachmentDisposition,
  deleteOriginals,
  originalPathname,
  originalsConfigured,
} from '@/lib/originals'
import { inSchool, withScope, type Scope } from '@/lib/user'

export const runtime = 'nodejs'

type Context = { params: Promise<{ id: string }> }

/**
 * The material's original file. Private blobs have no public URL, so the
 * download always goes through here — the school check decides, and the blob
 * address never reaches the browser.
 */
export async function GET(_request: Request, { params }: Context) {
  return withScope(async (account) => {
    const { id } = await params
    const material = await schoolMaterial(account, id)
    if (!originalsConfigured() || !material?.originalPathname) return notFound()

    const blob = await get(material.originalPathname, { access: 'private' })
    if (!blob || blob.statusCode !== 200) return notFound()
    return new Response(blob.stream, {
      headers: {
        'content-type': blob.blob.contentType,
        'content-length': String(blob.blob.size),
        'content-disposition': attachmentDisposition(material.fileName),
        'cache-control': 'private, no-store',
      },
    })
  })
}

/**
 * Client token for `upload()` from `@vercel/blob/client`: the browser sends
 * the file straight to Blob, our server only signs that it may — one material
 * of this school, at its fixed pathname, of the type and size it was saved with.
 */
export async function POST(request: Request, { params }: Context) {
  return withScope(
    async (account) => {
      const { id } = await params
      const material = await schoolMaterial(account, id)
      if (!originalsConfigured() || !material) return notFound()
      const expected = originalPathname(account, material.id, material.fileName)

      try {
        const result = await handleUpload({
          request,
          body: (await request.json()) as HandleUploadBody,
          onBeforeGenerateToken: async (pathname) => {
            if (pathname !== expected) throw new Error(`Unexpected original pathname ${pathname}`)
            return {
              allowedContentTypes: [material.mimeType || 'application/octet-stream'],
              maximumSizeInBytes: MAX_ORIGINAL_BYTES,
              addRandomSuffix: false,
              // A re-upload of the same material replaces its original.
              allowOverwrite: true,
            }
          },
        })
        return Response.json(result)
      } catch (error) {
        console.error('Original upload token refused:', error)
        return Response.json({ error: t('library:materialPreview.originalRefused') }, { status: 400 })
      }
    },
    { write: true },
  )
}

/**
 * After the browser finished the upload: links the blob to the material. The
 * pathname is computed here, not taken from the client, and the blob must
 * really exist — a claim alone attaches nothing.
 */
export async function PUT(_request: Request, { params }: Context) {
  return withScope(
    async (account) => {
      const { id } = await params
      const material = await schoolMaterial(account, id)
      if (!originalsConfigured() || !material) return notFound()
      const pathname = originalPathname(account, material.id, material.fileName)

      const exists = await head(pathname).then(
        () => true,
        () => false,
      )
      if (!exists) return notFound()

      await db
        .update(materials)
        .set({ originalPathname: pathname })
        .where(and(inSchool(account, materials), eq(materials.id, material.id)))
      // A file renamed in between had another pathname; the old blob would be left orphaned.
      if (material.originalPathname && material.originalPathname !== pathname) {
        await deleteOriginals([material.originalPathname])
      }
      return Response.json({ ok: true })
    },
    { write: true },
  )
}

async function schoolMaterial(scope: Scope, id: string) {
  const [row] = await db
    .select({
      id: materials.id,
      fileName: materials.fileName,
      mimeType: materials.mimeType,
      originalPathname: materials.originalPathname,
    })
    .from(materials)
    .where(and(inSchool(scope, materials), eq(materials.id, id)))
    .limit(1)
  return row ?? null
}

/** A foreign or missing material, or no original — all look the same from outside. */
const notFound = () => Response.json({ error: t('library:materialPreview.originalMissing') }, { status: 404 })
