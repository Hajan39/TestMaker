/**
 * Požadavky na vlastní API z prohlížeče s českou chybou pro učitelku.
 * Prohlížeč a platforma hlásí potíže anglicky („Failed to fetch“,
 * „Unexpected end of JSON input“) — ty se učitelce nikdy neukazují.
 */

/** Hláška, když server odpoví chybou bez vysvětlení (spadl, vypršel čas…). */
export const SERVER_TROUBLE = 'Server teď neodpověděl, jak měl. Zkus to za chvíli znovu; když to nepomůže, obnov stránku.'
export const OFFLINE = 'Nepodařilo se spojit se serverem. Zkontroluj připojení k internetu a zkus to znovu.'
export const SESSION_EXPIRED =
  'Přihlášení vypršelo. Přihlas se znovu v nové záložce — rozdělaná práce v tomhle okně zůstane — a zkus to znovu.'

/** Chyba s českou hláškou; `status` je 0, když se na server vůbec nedošlo. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Tělo odpovědi jako JSON; prázdné nebo rozbité tělo (pád serveru) = `{}`. */
export async function readJson<T>(response: Response): Promise<Partial<T> & { error?: string }> {
  try {
    return ((await response.json()) ?? {}) as Partial<T> & { error?: string }
  } catch {
    return {}
  }
}

/** Česká hláška k neúspěšné odpovědi: vlastní text serveru, nebo obecná rada. */
export function responseError(response: Response, data: { error?: unknown }, failure: string): RequestError {
  if (response.status === 401) return new RequestError(`${failure} ${SESSION_EXPIRED}`, 401)
  const own = typeof data.error === 'string' && data.error.trim() ? data.error : null
  return new RequestError(own ?? `${failure} ${SERVER_TROUBLE}`, response.status)
}

/** `fetch`, který místo síťové chyby prohlížeče hází českou `RequestError`. */
export async function fetchOrOffline(url: string, init: RequestInit | undefined, failure: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RequestError(`${failure} ${OFFLINE}`, 0)
  }
}

/**
 * Požadavek na API. Když server vrátí vlastní hlášku, použije se ta; jinak
 * obecná rada, co dělat. `failure` je první věta chyby („Test se nepodařilo smazat.“).
 */
export async function requestJson<T>(url: string, init: RequestInit | undefined, failure: string): Promise<Partial<T>> {
  const response = await fetchOrOffline(url, init, failure)
  const data = await readJson<T>(response)
  if (!response.ok) throw responseError(response, data, failure)
  return data
}

/** JSON tělo pro `requestJson`. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Text chyby k zobrazení. Hlášky z `RequestError` a vlastní české chyby
 * projdou; technické chyby prohlížeče (TypeError, SyntaxError) se nahradí radou.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError) return error.message
  if (error instanceof TypeError || error instanceof SyntaxError) return `${fallback} ${SERVER_TROUBLE}`
  return error instanceof Error && error.message ? error.message : fallback
}
