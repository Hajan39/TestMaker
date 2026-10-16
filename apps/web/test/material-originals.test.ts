import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { del, get, head } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { GET as text } from '@/app/api/materials/[id]/text/route'
import { GET as download, POST as uploadToken, PUT as attach } from '@/app/api/materials/[id]/original/route'
import { DELETE as deleteMaterial, POST as importMaterials } from '@/app/api/materials/route'
import { DELETE as deleteLibraryItem } from '@/app/api/library/route'
import { db, materials, schools, users } from '@/db'
import { newId } from '@/lib/ids'
import { attachmentDisposition, safeFileName } from '@/lib/originals'
import { jsonReq, req, seedMaterial, seedTopic } from './helpers'
import { TEST_SCHOOL_ID } from './setup'

vi.mock('@vercel/blob', () => ({ get: vi.fn(), head: vi.fn(), del: vi.fn() }))
vi.mock('@vercel/blob/client', () => ({ handleUpload: vi.fn() }))
// Without a session cookie: with `AUTH_SECRET` set, nobody is signed in.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(get).mockReset()
  vi.mocked(head).mockReset()
  vi.mocked(del).mockReset()
  vi.mocked(handleUpload).mockReset()
})

async function otherSchoolTeacher(): Promise<string> {
  const schoolId = newId()
  await db.insert(schools).values({ id: schoolId, name: 'Jiná škola', slug: `jina-originaly-${schoolId}` })
  const userId = newId()
  await db.insert(users).values({ id: userId, schoolId, email: `${userId}@localhost`, name: 'Cizí', role: 'ucitelka' })
  return userId
}

async function materialWithOriginal(fileName = 'Buňka.pdf') {
  const { topicId } = await seedTopic()
  const id = await seedMaterial(topicId, { fileName, text: 'První odstavec.\n\nDruhý odstavec.' })
  const pathname = `materials/${TEST_SCHOOL_ID}/${id}/${safeFileName(fileName)}`
  await db.update(materials).set({ originalPathname: pathname }).where(eq(materials.id, id))
  return { id, topicId, pathname }
}

describe('material text preview', () => {
  it('returns the stored text with its paragraphs', async () => {
    const { id } = await materialWithOriginal()
    const response = await text(req(`/api/materials/${id}/text`), params(id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: 'První odstavec.\n\nDruhý odstavec.' })
  })

  it('a material of another school does not exist — 404', async () => {
    const { id } = await materialWithOriginal()
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())
    const response = await text(req(`/api/materials/${id}/text`), params(id))
    expect(response.status).toBe(404)
  })
})

describe('original download', () => {
  it('streams the private blob under the original name', async () => {
    const { id, pathname } = await materialWithOriginal('Buňka.pdf')
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new Blob(['%PDF']).stream(),
      headers: new Headers(),
      blob: { contentType: 'application/pdf', size: 4 },
    } as never)

    const response = await download(req(`/api/materials/${id}/original`), params(id))

    expect(response.status).toBe(200)
    expect(get).toHaveBeenCalledWith(pathname, { access: 'private' })
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(attachmentDisposition('Buňka.pdf'))
    expect(await response.text()).toBe('%PDF')
  })

  it('a material of another school does not exist — 404 and Blob is not touched', async () => {
    const { id } = await materialWithOriginal()
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())
    const response = await download(req(`/api/materials/${id}/original`), params(id))
    expect(response.status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('without a Blob token there is no original — 404', async () => {
    const { id } = await materialWithOriginal()
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const response = await download(req(`/api/materials/${id}/original`), params(id))
    expect(response.status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('a material uploaded before originals were kept — 404', async () => {
    const { topicId } = await seedTopic()
    const id = await seedMaterial(topicId)
    const response = await download(req(`/api/materials/${id}/original`), params(id))
    expect(response.status).toBe(404)
  })
})

describe('original upload', () => {
  const tokenRequest = (id: string, pathname: string) =>
    jsonReq(`/api/materials/${id}/original`, 'POST', {
      type: 'blob.generate-client-token',
      payload: { pathname, multipart: false, clientPayload: null },
    })

  it('refuses a token to someone not signed in', async () => {
    const { id, pathname } = await materialWithOriginal()
    vi.stubEnv('AUTH_SECRET', 'tajne-heslo-pro-test')
    const response = await uploadToken(tokenRequest(id, pathname), params(id))
    expect(response.status).toBe(401)
    expect(handleUpload).not.toHaveBeenCalled()
  })

  it('signs only the material’s own pathname, type and size limit', async () => {
    const { id, pathname } = await materialWithOriginal()
    vi.mocked(handleUpload).mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'token' })

    const response = await uploadToken(tokenRequest(id, pathname), params(id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 'blob.generate-client-token', clientToken: 'token' })

    const { onBeforeGenerateToken } = vi.mocked(handleUpload).mock.calls[0]![0]
    await expect(onBeforeGenerateToken(pathname, null, false)).resolves.toMatchObject({
      allowedContentTypes: ['text/plain'],
      maximumSizeInBytes: 100 * 1024 * 1024,
    })
    await expect(onBeforeGenerateToken(`materials/jina-skola/${id}/x.pdf`, null, false)).rejects.toThrow()
  })

  it('a material of another school gets no token', async () => {
    const { id, pathname } = await materialWithOriginal()
    vi.stubEnv('E2E_UZIVATEL', await otherSchoolTeacher())
    const response = await uploadToken(tokenRequest(id, pathname), params(id))
    expect(response.status).toBe(404)
    expect(handleUpload).not.toHaveBeenCalled()
  })

  it('links the blob only once it really exists', async () => {
    const { topicId } = await seedTopic()
    const id = await seedMaterial(topicId, { fileName: 'Žába.docx' })
    const pathname = `materials/${TEST_SCHOOL_ID}/${id}/Zaba.docx`

    vi.mocked(head).mockRejectedValue(new Error('not found'))
    expect((await attach(req(`/api/materials/${id}/original`, { method: 'PUT' }), params(id))).status).toBe(404)
    const [missing] = await db.select().from(materials).where(eq(materials.id, id))
    expect(missing!.originalPathname).toBeNull()

    vi.mocked(head).mockResolvedValue({ size: 10 } as never)
    expect((await attach(req(`/api/materials/${id}/original`, { method: 'PUT' }), params(id))).status).toBe(200)
    expect(head).toHaveBeenLastCalledWith(pathname)
    const [linked] = await db.select().from(materials).where(eq(materials.id, id))
    expect(linked!.originalPathname).toBe(pathname)
  })

  it('import offers an upload place only when Blob is configured', async () => {
    const material = (topic: string) => ({
      relativePath: `${topic}/Soubor.txt`,
      fileName: 'Soubor.txt',
      subject: 'Přírodopis',
      grade: '8. ročník',
      topic,
      mimeType: 'text/plain',
      sizeBytes: 100,
      text: 'Text materiálu. '.repeat(30),
      pageCount: null,
      needsOcr: false,
      contentHash: `hash-${topic}`,
    })

    const withBlob = await importMaterials(jsonReq('/api/materials?group=0', 'POST', { materials: [material('S Blobem')] }))
    const [created] = ((await withBlob.json()) as { created: { id: string; originalPathname: string }[] }).created
    expect(created!.originalPathname).toBe(`materials/${TEST_SCHOOL_ID}/${created!.id}/Soubor.txt`)

    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    const withoutBlob = await importMaterials(jsonReq('/api/materials?group=0', 'POST', { materials: [material('Bez Blobu')] }))
    expect(((await withoutBlob.json()) as { created: { originalPathname: null }[] }).created).toEqual([
      expect.objectContaining({ originalPathname: null }),
    ])
  })
})

describe('deleting removes the original', () => {
  it('when the material is deleted', async () => {
    const { id, pathname } = await materialWithOriginal()
    const response = await deleteMaterial(req(`/api/materials?id=${id}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)
    expect(del).toHaveBeenCalledWith([pathname])
  })

  it('when its whole topic is deleted', async () => {
    const { topicId, pathname } = await materialWithOriginal()
    const response = await deleteLibraryItem(req(`/api/library?kind=topic&id=${topicId}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)
    expect(del).toHaveBeenCalledWith([pathname])
  })
})

describe('download file name', () => {
  it('keeps the exact name in filename* and an ASCII fallback in filename', () => {
    expect(attachmentDisposition('Přehled "buňky" (2).pdf')).toBe(
      `attachment; filename="Prehled _bunky_ (2).pdf"; filename*=UTF-8''P%C5%99ehled%20%22bu%C5%88ky%22%20%282%29.pdf`,
    )
  })

  it('makes a Blob-safe pathname segment', () => {
    expect(safeFileName('Žáci 7.A – opakování.pptx')).toBe('Zaci_7.A_opakovani.pptx')
    expect(safeFileName('../../tajne')).toBe('tajne')
    expect(safeFileName('ěščř')).toBe('escr')
    expect(safeFileName('???')).toBe('file')
  })
})
