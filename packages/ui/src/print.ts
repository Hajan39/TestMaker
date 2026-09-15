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
