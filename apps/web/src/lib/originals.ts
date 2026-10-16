import 'server-only'
import { del } from '@vercel/blob'
import type { Scope } from '@/lib/user'

/**
 * Original files of materials, kept in private Vercel Blob storage. The app
 * itself works only with the extracted text; the original is there so the
 * teacher can download what she once uploaded. The browser uploads it
 * straight to Blob (`upload()` from `@vercel/blob/client`) — never through our
 * route body, which Vercel caps at 4.5 MB.
 */

/** Originals are kept only when a Blob store is connected; without it everything works on text alone. */
export function originalsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
}

/** Where a material's original lives — per school and material, so one never overwrites another. */
export function originalPathname(scope: Scope, materialId: string, fileName: string): string {
  return `materials/${scope.schoolId}/${materialId}/${safeFileName(fileName)}`
}

/** File name usable in a Blob pathname: ASCII letters, digits, dot, dash and underscore. */
export function safeFileName(fileName: string): string {
  const safe = asciiFold(fileName)
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-100)
  return safe || 'file'
}

/**
 * `Content-Disposition` for a download under the original name. Old clients
 * get an ASCII fallback in `filename`, the rest the exact name in RFC 5987
 * `filename*` (diacritics included).
 */
export function attachmentDisposition(fileName: string): string {
  const fallback = asciiFold(fileName).replace(/[^\x20-\x7e]|["\\]/g, '_') || 'file'
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

function asciiFold(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Deletes originals of materials already removed from the database. Never
 * fails the deletion it follows — the material is gone either way; a blob
 * left behind only costs storage, so it is logged.
 */
export async function deleteOriginals(pathnames: (string | null)[]): Promise<void> {
  const existing = pathnames.filter((pathname): pathname is string => Boolean(pathname))
  if (existing.length === 0 || !originalsConfigured()) return
  try {
    await del(existing)
  } catch (error) {
    console.error('Failed to delete material originals:', existing, error)
  }
}
