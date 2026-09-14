/**
 * Lokální import složky s materiály (alternativa k importu v prohlížeči).
 * Používá stejné extraktory jako web, jen s jsdom místo DOMParseru prohlížeče.
 *
 *   pnpm --filter @testmaker/web import:local ../../sources
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { webcrypto } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import {
  extractDocx,
  extractHtml,
  extractOdf,
  extractPdf,
  fileExtension,
  hashText,
  parsePath,
  skipReason,
} from '@testmaker/core/extract'

// Extraktory očekávají prostředí prohlížeče; DOMParser i crypto se čtou až za běhu.
const dom = new JSDOM()
globalThis.DOMParser = dom.window.DOMParser
if (!globalThis.crypto) globalThis.crypto = webcrypto as Crypto

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  odp: 'application/vnd.oasis.opendocument.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

async function extract(path: string) {
  const ext = fileExtension(path)
  if (ext === 'pdf') return extractPdf(new Uint8Array(await readFile(path)))
  if (ext === 'odp' || ext === 'odt' || ext === 'ods') return extractOdf(await readFile(path))
  if (ext === 'docx') return extractDocx(await readFile(path))
  if (ext === 'html' || ext === 'htm') return extractHtml(await readFile(path, 'utf8'))
  const text = await readFile(path, 'utf8')
  return { text: text.trim(), pageCount: null, needsOcr: text.trim().length < 40 }
}

async function main() {
  const root = resolve(process.argv[2] ?? '../../sources')
  const apiUrl = process.env.IMPORT_API_URL ?? 'http://localhost:3000/api/materials'
  const rootName = basename(root)

  const materials: ExtractedMaterial[] = []
  const skippedReasons = new Map<string, number>()
  const failures: string[] = []

  for await (const path of walk(root)) {
    const relativePath = `${rootName}/${relative(root, path)}`
    const reason = skipReason(relativePath)
    if (reason) {
      skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1)
      continue
    }
    try {
      const parsed = parsePath(relativePath)
      const result = await extract(path)
      if (result.text.length < 40 && !result.needsOcr) {
        skippedReasons.set('prázdný text', (skippedReasons.get('prázdný text') ?? 0) + 1)
        continue
      }
      materials.push({
        relativePath,
        fileName: parsed.fileName,
        subject: parsed.subject,
        grade: parsed.grade,
        topic: parsed.topic,
        mimeType: MIME[parsed.extension] ?? 'application/octet-stream',
        sizeBytes: (await stat(path)).size,
        text: result.text,
        pageCount: result.pageCount,
        needsOcr: result.needsOcr,
        contentHash: await hashText(result.text),
      })
      process.stdout.write(`\r${materials.length} souborů přečteno`)
    } catch (error) {
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log(`\nPřečteno ${materials.length} materiálů, chyb ${failures.length}.`)
  for (const [reason, count] of skippedReasons) console.log(`  přeskočeno (${reason}): ${count}`)
  for (const failure of failures.slice(0, 20)) console.log(`  CHYBA ${failure}`)

  let imported = 0
  let duplicates = 0
  for (let i = 0; i < materials.length; i += 10) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ materials: materials.slice(i, i + 10) }),
    })
    if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`)
    const result = (await response.json()) as { imported: number; duplicates: number }
    imported += result.imported
    duplicates += result.duplicates
    process.stdout.write(`\rUloženo ${imported}, duplicit ${duplicates}`)
  }
  console.log(`\nHotovo: ${imported} nových materiálů, ${duplicates} duplicit.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
