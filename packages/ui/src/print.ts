'use client'

/**
 * Pošle PDF rovnou do tisku, aby učitelka nemusela soubor stahovat a otevírat zvlášť.
 *
 * Prohlížeče se u vestavěného prohlížeče PDF chovají různě, proto je tu záložní cesta:
 * když se tisk do pár vteřin nepodaří vyvolat, otevře se PDF v nové záložce, kde si ho
 * uživatelka vytiskne sama.
 *
 * Vrací příslib, který se naplní, jakmile je o tisku rozhodnuto — voláním, nebo záložní
 * cestou. Volající podle toho může schovat hlášku „Připravuji tisk“.
 */
export function printPdf(href: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.right = '0'
    frame.style.bottom = '0'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.src = href

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
      window.open(href, '_blank', 'noopener')
      finish()
    }, timeoutMs)

    frame.onload = () => {
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
  const response = await fetch(href)
  if (!response.ok) throw new Error(`PDF se nepodařilo připravit (${response.status}).`)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileNameFromHeader(response.headers.get('content-disposition')) ?? fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
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
