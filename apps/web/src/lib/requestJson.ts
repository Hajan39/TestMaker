import { t } from '@testmaker/core/i18n'

/**
 * Browser requests to our own API with a translated, actionable error for
 * the teacher. Browsers and the platform report trouble in English
 * ("Failed to fetch", "Unexpected end of JSON input") — never shown as is.
 */

/** Error carrying a user-facing message; `status` is 0 when the server was never reached. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** Response body as JSON; an empty or broken body (server crash) becomes `{}`. */
export async function readJson<T>(response: Response): Promise<Partial<T> & { error?: string }> {
  try {
    return ((await response.json()) ?? {}) as Partial<T> & { error?: string }
  } catch {
    return {}
  }
}

/** Message for a failed response: the server's own text, or generic advice. */
export function responseError(response: Response, data: { error?: unknown }, failure: string): RequestError {
  if (response.status === 401) return new RequestError(`${failure} ${t('common:errors.sessionExpired')}`, 401)
  const own = typeof data.error === 'string' && data.error.trim() ? data.error : null
  return new RequestError(own ?? `${failure} ${t('common:errors.serverTrouble')}`, response.status)
}

/** `fetch` that throws a translated `RequestError` instead of the browser's network error. */
export async function fetchOrOffline(url: string, init: RequestInit | undefined, failure: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RequestError(`${failure} ${t('common:errors.offline')}`, 0)
  }
}

/**
 * Request to the API. The server's own message wins; otherwise generic
 * advice. `failure` is the first sentence of the error ("The test could not be deleted.").
 */
export async function requestJson<T>(url: string, init: RequestInit | undefined, failure: string): Promise<Partial<T>> {
  const response = await fetchOrOffline(url, init, failure)
  const data = await readJson<T>(response)
  if (!response.ok) throw responseError(response, data, failure)
  return data
}

/** JSON body for `requestJson`. */
export function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/**
 * Error text to display. Messages from `RequestError` and our own errors pass
 * through; technical browser errors (TypeError, SyntaxError) become advice.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError) return error.message
  if (error instanceof TypeError || error instanceof SyntaxError) return `${fallback} ${t('common:errors.serverTrouble')}`
  return error instanceof Error && error.message ? error.message : fallback
}
