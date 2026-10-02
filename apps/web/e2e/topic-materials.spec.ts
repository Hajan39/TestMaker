import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import JSZip from 'jszip'

/**
 * The topic's materials strip: uploading files straight here (no detour via
 * `/import`), re-uploading the same file doesn't duplicate it, an unsupported
 * file ends up among the skipped, and the "Použít pro generování" toggle
 * changes the strip header count right away.
 *
 * The `nahled` role (no upload, toggle or delete) is in `role.spec.ts` — it
 * runs under the sign-in config this file doesn't have.
 */

const SUBJECT = 'E2E MATERIALY'
const GRADE = 'E2E pruh materiálů'
const TOPIC = 'Pruh materiálů v tématu'

/** Text long enough that the material isn't flagged as "skoro bez textu". */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

/**
 * The smallest PDF with a text layer. The xref offsets are computed so pdf.js
 * doesn't read it in repair mode — extraction is under test, not resilience to defects.
 */
function pdf(sentence: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${sentence}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = out.length
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** An ODP presentation with two slides — `content.xml` is enough, extraction reads nothing else. */
async function odp(sentence: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation')
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:presentation>
    <draw:page><draw:frame><draw:text-box><text:p>${sentence}</text:p></draw:text-box></draw:frame></draw:page>
    <draw:page><draw:frame><draw:text-box><text:p>${sentence}</text:p></draw:text-box></draw:frame></draw:page>
  </office:presentation></office:body>
</office:document-content>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** A DOCX document with one paragraph. */
async function docx(sentence: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${sentence}</w:t></w:r></w:p></w:body>
</w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** Creates a test topic with one material and returns its id. */
async function ensureTopic(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${TOPIC}/Úvodní materiál.txt`,
          fileName: 'Úvodní materiál.txt',
          subject: SUBJECT,
          grade: GRADE,
          topic: TOPIC,
          mimeType: 'text/plain',
          sizeBytes: 400,
          text: text('Úvodní materiál založený přes API, aby téma existovalo.'),
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-tema-materialy-uvod-${Date.now()}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC))
  expect(topic, `test topic "${TOPIC}" not found in the library`).toBeTruthy()
  return topic!.topicId
}

async function cleanup(request: APIRequestContext, topicId: string) {
  const deleted = await request.delete(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(deleted.ok(), 'failed to clean up the test topic').toBe(true)
}

/** Expands the materials strip — it is collapsed when there are materials. */
async function expandStrip(page: Page) {
  const trigger = page.getByRole('button', { name: /^Materiály/ })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
}

test.describe('topic materials strip', () => {
  test('two uploaded files appear in the strip and are not duplicated the second time', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const first = {
        name: 'Nahraný přímo do tématu 1.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('První soubor nahraný rovnou do tématu.'), 'utf8'),
      }
      const second = {
        name: 'Nahraný přímo do tématu 2.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('Druhý soubor nahraný rovnou do tématu.'), 'utf8'),
      }

      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first, second])
      await expect(page.getByText(/Nahráno 2 materiály/)).toBeVisible()
      await expect(page.getByText(first.name)).toBeVisible()
      await expect(page.getByText(second.name)).toBeVisible()

      // Uploading the same file again: no duplicate, and the message says so —
      // nothing is saved this time, so the sentence only talks about duplicates.
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first])
      await expect(page.getByText('Všechny soubory už v tématu byly.')).toBeVisible()
      await expect(page.getByText(first.name)).toHaveCount(1)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  // Extraction runs in a web worker, which has no `DOMParser` and where pdf.js
  // can't start its own worker — the text files above would not reveal that.
  test('PDF, ODP, DOCX and HTML are read and uploaded', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Each file has different content, otherwise they would flag each other as duplicates.
      const files = [
        {
          name: 'Prezentace.odp',
          mimeType: 'application/vnd.oasis.opendocument.presentation',
          buffer: await odp('Fotosynteza probiha v chloroplastech zelenych rostlin a vyzaduje svetlo.'),
        },
        {
          name: 'Vyklad.pdf',
          mimeType: 'application/pdf',
          buffer: pdf('Sopky vznikaji tam, kde magma z plaste pronika zemskou kurou na povrch.'),
        },
        {
          name: 'Poznamky.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: await docx('Rimska rise se rozkladala kolem Stredozemniho more a jejim centrem byl Rim.'),
        },
        {
          name: 'Stranka.html',
          mimeType: 'text/html',
          buffer: Buffer.from(
            '<html><body><script>x()</script><p>Mitochondrie jsou elektrarny bunky a vyrabeji energii ve forme ATP.</p></body></html>',
            'utf8',
          ),
        },
      ]
      await page.locator('[data-testid="topic-material-files"]').setInputFiles(files)

      await expect(page.getByText(/Nahráno 4 materiály/)).toBeVisible()
      for (const file of files) await expect(page.getByText(file.name, { exact: true })).toBeVisible()
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('an unsupported file ends up among the skipped', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const unsupported = {
        name: 'poznamky.xyz',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('obsah v nepodporovaném formátu', 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([unsupported])

      await page.getByText(/^Přeskočeno/).click()
      await expect(page.getByText(unsupported.name)).toBeVisible()
      await expect(page.getByText('nepodporovaná přípona')).toBeVisible()
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('turning off "Použít pro generování" lowers the strip header count', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const header = page.getByRole('button', { name: /^Materiály/ })
      await expect(header).toContainText('Materiály 1')
      // The space between the word and the number must be real — otherwise the
      // button's accessible name would be "Materiály1" and a screen reader
      // would read it as one word.
      await expect(header).toHaveAccessibleName(/Materiály 1/)

      await page.getByRole('checkbox', { name: /Použít pro generování: Úvodní materiál\.txt/ }).click()

      await expect(header).toContainText('Materiály 0 + 1 vynechaný')
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('a file without text ends up among the skipped, not without a trace', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Fewer than 40 characters — extraction treats it as empty, not as a scan.
      const empty = {
        name: 'prazdna-poznamka.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('pár slov', 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([empty])

      await page.getByText(/^Přeskočeno/).click()
      await expect(page.getByText(empty.name)).toBeVisible()
      await expect(page.getByText('soubor neobsahuje žádný text')).toBeVisible()
      // It wasn't added to the topic's materials.
      await expect(page.getByText(empty.name).locator('..').getByRole('checkbox')).toHaveCount(0)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('a duplicate row has the "Použít pro generování" checkbox unchecked and locked', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // A second file with a subset of the content of the first one that
      // created the topic (`ensureTopic`) — the shorter text guarantees it is
      // recognised as its duplicate and not vice versa (the longer one wins).
      const duplicate = {
        name: 'Duplicitní kopie.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(text('Úvodní materiál založený přes API, aby téma existovalo.').slice(0, 200), 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([duplicate])
      await expect(page.getByText('stejný obsah jako')).toBeVisible()

      const duplicateCheckbox = page.getByRole('checkbox', {
        name: `Použít pro generování: ${duplicate.name}`,
      })
      await expect(duplicateCheckbox).not.toBeChecked()
      await expect(duplicateCheckbox).toBeDisabled()
    } finally {
      await cleanup(page.request, topicId)
    }
  })
})
