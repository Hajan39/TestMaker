/**
 * Chyby od poskytovatele modelu chodí anglicky a plné technických odkazů.
 * Učitelka z „You exceeded your current quota" nepozná, jestli má čekat,
 * zaplatit, nebo něco přepnout. Tahle vrstva je překládá na větu, ze které
 * je jasné, co dělat dál.
 */

export interface AiFailure {
  /** Hláška do rozhraní, česky. */
  message: string
  /** Má smysl to zkusit znovu později? */
  retryable: boolean
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return `${error.message} ${cause instanceof Error ? cause.message : ''}`
  }
  return String(error)
}

/** Přeloží chybu od modelu na srozumitelné vysvětlení. */
export function describeAiError(error: unknown): AiFailure {
  const raw = textOf(error)
  const lower = raw.toLowerCase()

  if (lower.includes('exceeded your current quota') || lower.includes('free_tier') || lower.includes('rate limit')) {
    return {
      message:
        'Vyčerpaný limit modelu. U bezplatných tarifů se limit počítá na den — zkus to znovu zítra, ' +
        'nebo dopiš do .env.local (AI_MODELS) další model, třeba placený přes OpenRouter.',
      retryable: true,
    }
  }
  if (lower.includes('experiencing high demand') || lower.includes('overloaded') || lower.includes('503')) {
    return {
      message: 'Model je právě přetížený. Za chvíli to zkus znovu, nebo dopiš do AI_MODELS další model.',
      retryable: true,
    }
  }
  if (lower.includes('api key') || lower.includes('unauthenticated') || lower.includes('permission denied')) {
    return {
      message: 'Klíč k modelu neplatí nebo chybí. Zkontroluj ho v souboru .env.local a restartuj aplikaci.',
      retryable: false,
    }
  }
  if (lower.includes('no longer available')) {
    return {
      message: 'Zvolený model už poskytovatel nenabízí. Oprav jeho název v AI_MODELS v .env.local.',
      retryable: false,
    }
  }
  if (lower.includes('aborted') || lower.includes('abort')) {
    return { message: 'Generování bylo přerušeno.', retryable: true }
  }

  // Neznámou chybu nemá smysl převyprávět; aspoň ji zkrátíme, ať se vejde do rozhraní.
  return { message: raw.trim().slice(0, 300) || 'Generování selhalo z neznámého důvodu.', retryable: true }
}
