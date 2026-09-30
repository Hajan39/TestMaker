import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import JSZip from 'jszip'

/**
 * Pruh materiálů v tématu: nahrání souborů rovnou sem (bez oklikou přes
 * `/import`), opakované nahrání téhož souboru se nezdvojí, nepodporovaný
 * soubor skončí mezi přeskočenými a přepínač „Použít pro generování“ hned
 * mění počet v hlavičce pruhu.
 *
 * Role `nahled` (bez nahrávání, přepínače a mazání) je v `role.spec.ts` —
 * ten běží přes přihlašovací konfiguraci, kterou tenhle soubor nemá.
 */

const SUBJECT = 'E2E MATERIALY'
const GRADE = 'E2E pruh materiálů'
const TOPIC = 'Pruh materiálů v tématu'

/** Dost dlouhý text, aby materiál nebyl označený jako „skoro bez textu“. */
function text(sentence: string): string {
  return `${sentence} `.repeat(30)
}

/**
 * Nejmenší PDF s textovou vrstvou. Offsety v xref se počítají, ať ho pdf.js
 * nečte přes opravný režim — zkouší se extrakce, ne odolnost vůči vadám.
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

/** Prezentace ODP se dvěma slidy — stačí `content.xml`, víc extrakce nečte. */
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

/** Dokument DOCX s jedním odstavcem. */
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

/** Založí zkušební téma s jedním materiálem a vrátí jeho id. */
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
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC))
  expect(topic, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

async function cleanup(request: APIRequestContext, topicId: string) {
  const deleted = await request.delete(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(deleted.ok(), 'zkušební téma se nepodařilo uklidit').toBe(true)
}

/** Rozbalí pruh materiálů — s materiály je sbalený. */
async function expandStrip(page: Page) {
  const trigger = page.getByRole('button', { name: /^Materiály/ })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
}

test.describe('pruh materiálů v tématu', () => {
  test('nahrání dvou souborů se objeví v pruhu a podruhé se nezdvojí', async ({ page }) => {
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

      // Nahrání téhož souboru podruhé: nezdvojí se a hláška to řekne rovnou —
      // nic se tentokrát neuloží, takže věta mluví jen o duplicitách.
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([first])
      await expect(page.getByText('Všechny soubory už v tématu byly.')).toBeVisible()
      await expect(page.getByText(first.name)).toHaveCount(1)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  // Extrakce běží ve web workeru, kde není `DOMParser` a pdf.js si tam
  // nespustí vlastní worker — textové soubory výš by to neodhalily.
  test('PDF, ODP, DOCX i HTML se přečtou a nahrají', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Každý soubor jiný obsah, jinak by se navzájem označily za duplicity.
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

  test('nepodporovaný soubor skončí mezi přeskočenými', async ({ page }) => {
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

  test('vypnutí „Použít pro generování“ sníží počet v hlavičce pruhu', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      const header = page.getByRole('button', { name: /^Materiály/ })
      await expect(header).toContainText('Materiály 1')
      // Mezera mezi slovem a číslem musí být skutečná — jinak by přístupný
      // název tlačítka zněl „Materiály1“ a čtečka obrazovky by ho přečetla
      // jako jedno slovo.
      await expect(header).toHaveAccessibleName(/Materiály 1/)

      await page.getByRole('checkbox', { name: /Použít pro generování: Úvodní materiál\.txt/ }).click()

      await expect(header).toContainText('Materiály 0 + 1 vynechaný')
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('soubor bez textu skončí mezi přeskočenými, ne beze stopy', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Míň než 40 znaků — extrakce ho vyhodnotí jako prázdný, ne jako sken.
      const empty = {
        name: 'prazdna-poznamka.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('pár slov', 'utf8'),
      }
      await page.locator('[data-testid="topic-material-files"]').setInputFiles([empty])

      await page.getByText(/^Přeskočeno/).click()
      await expect(page.getByText(empty.name)).toBeVisible()
      await expect(page.getByText('soubor neobsahuje žádný text')).toBeVisible()
      // Nepřibyl mezi materiály tématu.
      await expect(page.getByText(empty.name).locator('..').getByRole('checkbox')).toHaveCount(0)
    } finally {
      await cleanup(page.request, topicId)
    }
  })

  test('duplicitní řádek má checkbox „Použít pro generování“ odškrtnutý a zamčený', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    try {
      await page.goto(`/topics/${topicId}`)
      await expandStrip(page)

      // Druhý soubor s podmnožinou obsahu prvního, co založil téma
      // (`ensureTopic`) — kratší text zaručuje, že se rozpozná jako
      // duplicita jeho a ne naopak (rozhoduje delší z dvojice).
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
