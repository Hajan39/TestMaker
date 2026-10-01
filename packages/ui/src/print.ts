'use client'

const PDF_FAILED = 'PDF se nepodařilo připravit.'
const PDF_RETRY = 'Zkus to za chvíli znovu; když to nepomůže, obnov stránku.'
const PDF_OFFLINE = 'Nepodařilo se spojit se serverem. Zkontroluj připojení k internetu a zkus to znovu.'

/** Iframe posledního tisku; s dalším tiskem se uklidí (hned po tisku by ho Chrome zrušil). */
let lastFrame: HTMLIFrameElement | null = null

/**
 * Stáhne PDF a ověří, že opravdu přišlo PDF. Chyba serveru (404, vypršelé
 * přihlášení, hlavolam, který nejde vykreslit) se tak nevytiskne jako text
 * na papír, ale skončí českou chybou, kterou volající ukáže.
 */
async function fetchPdf(href: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(href)
  } catch {
    throw new Error(`${PDF_FAILED} ${PDF_OFFLINE}`)
  }
  if (response.ok) return response
  const text = await response.text().catch(() => '')
  let own: string | null = null
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') own = parsed.error
  } catch {
    // Prostý text posílají PDF routy jen česky a krátce; HTML stránku platformy ne.
    if (text && text.length < 300 && !text.trimStart().startsWith('<')) own = text.trim()
  }
  throw new Error(own ? `${PDF_FAILED} ${own}` : `${PDF_FAILED} ${PDF_RETRY}`)
}

/**
 * Pošle PDF rovnou do tisku, aby učitelka nemusela soubor stahovat a otevírat zvlášť.
 *
 * PDF se nejdřív stáhne a teprve hotové jde do skrytého rámu. Prohlížeče se
 * u vestavěného prohlížeče PDF chovají různě, proto je tu záložní cesta: když
 * se tisk do pár vteřin nepodaří vyvolat, PDF se uloží jako soubor (nové okno
 * by po čekání na server blokátor vyskakovacích oken stejně zastavil).
 *
 * Příslib se naplní, jakmile je o tisku rozhodnuto; když PDF nepřijde, odmítne
 * se s českou chybou.
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
      // Tisk se nepodařilo vyvolat; ať uživatelka neskončí s prázdnýma rukama.
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
        // Necháme doběhnout záložní cestu.
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
 * Stáhne PDF a uloží ho jako soubor. Odkaz `target="_blank"` tu nestačí:
 * vykreslení testu trvá vteřiny a otevřená prázdná záložka nic neříká, zatímco
 * původní stránka se tváří, že se nic nestalo. Takhle se čekání odehraje tam,
 * kde na něj jde ukázat — volající si po dobu příslibu drží stav „Připravuji…“.
 *
 * Název souboru posílá server v hlavičce `content-disposition`; když chybí
 * nebo se nedá přečíst, použije se záložní.
 */
export async function downloadPdf(href: string, fallbackName = 'test.pdf'): Promise<void> {
  const response = await fetchPdf(href)
  const url = URL.createObjectURL(await response.blob())
  saveBlobUrl(url, fileNameFromHeader(response.headers.get('content-disposition')) ?? fallbackName)
  // Uvolnit až po chvíli: některé prohlížeče si adresu ještě čtou.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Vytáhne název souboru z hlavičky; zvládá i tvar `filename*=UTF-8''…`. */
function fileNameFromHeader(header: string | null): string | undefined {
  if (!header) return undefined
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!)
    } catch {
      // Poškozená hlavička: raději záložní název než spadnout.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain?.[1]
}
