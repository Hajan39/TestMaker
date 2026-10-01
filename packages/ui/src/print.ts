'use client'

import { t } from '@testmaker/core/i18n'

/** Iframe of the last print; cleaned up on the next print (removing it right after printing would cancel it in Chrome). */
let lastFrame: HTMLIFrameElement | null = null

/**
 * Fetches the PDF and checks that a PDF really arrived. A server error (404,
 * expired session, a puzzle that cannot be rendered) is then not printed as
 * text on paper but ends in a readable error the caller shows.
 */
async function fetchPdf(href: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(href)
  } catch {
    throw new Error(`${t('ui:print.failed')} ${t('errors.offline')}`)
  }
  if (response.ok) return response
  const text = await response.text().catch(() => '')
  let own: string | null = null
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') own = parsed.error
  } catch {
    // PDF routes send plain text only as a short Czech message; not the platform's HTML page.
    if (text && text.length < 300 && !text.trimStart().startsWith('<')) own = text.trim()
  }
  throw new Error(`${t('ui:print.failed')} ${own ?? t('ui:print.retry')}`)
}

/**
 * Sends a PDF straight to print so the teacher does not have to download and
 * open the file separately.
 *
 * The PDF is fetched first and only then put into a hidden frame. Browsers
 * differ in how their built-in PDF viewer behaves, hence the fallback: if
 * printing cannot be triggered within a few seconds, the PDF is saved as a file
 * (a new window would be stopped by the popup blocker after waiting for the
 * server anyway).
 *
 * The promise resolves once printing is decided; if no PDF arrives it rejects
 * with a readable error.
 */
export async function printPdf(href: string, timeoutMs = 4000): Promise<void> {
  const response = await fetchPdf(href)
  const url = URL.createObjectURL(await response.blob())
  const name = fileNameFromHeader(response.headers.get('content-disposition')) ?? 'test.pdf'

  if (lastFrame) {
    URL.revokeObjectURL(lastFrame.src)
    lastFrame.remove()
  }
  const frame = document.createElement('iframe')
  lastFrame = frame
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.src = url

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(fallback)
      resolve()
    }

    const fallback = window.setTimeout(() => {
      if (settled) return
      // Printing could not be triggered; do not leave the user empty-handed.
      saveBlobUrl(url, name)
      finish()
    }, timeoutMs)

    frame.onload = () => {
      if (settled) return
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
        finish()
      } catch {
        // Let the fallback run.
      }
    }

    document.body.appendChild(frame)
  })
}

function saveBlobUrl(url: string, name: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/**
 * Fetches a PDF and saves it as a file. A `target="_blank"` link is not enough:
 * rendering a test takes seconds and an empty open tab says nothing, while the
 * original page acts as if nothing happened. This way the wait happens where it
 * can be shown — the caller keeps a "Připravuji…" state for the promise's
 * duration.
 *
 * The server sends the file name in the `content-disposition` header; when it
 * is missing or unreadable, the fallback is used.
 */
export async function downloadPdf(href: string, fallbackName = 'test.pdf'): Promise<void> {
  const response = await fetchPdf(href)
  const url = URL.createObjectURL(await response.blob())
  saveBlobUrl(url, fileNameFromHeader(response.headers.get('content-disposition')) ?? fallbackName)
  // Revoke only after a while: some browsers are still reading the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Extracts the file name from the header; also handles `filename*=UTF-8''…`. */
function fileNameFromHeader(header: string | null): string | undefined {
  if (!header) return undefined
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!)
    } catch {
      // Broken header: better a fallback name than a crash.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain?.[1]
}
