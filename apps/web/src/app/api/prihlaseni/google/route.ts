import { OAUTH_COOKIE } from '@/lib/session'
import {
  safeReturnPath,
  googleSettings,
  newOauthState,
  redirectResponse,
  authorizationUrl,
} from '@/lib/google'
import { t } from '@testmaker/core/i18n'

export const runtime = 'nodejs'

/**
 * Start of Google sign-in. The state and PKCE secret are stored in a short
 * cookie, not the database: on serverless the next request shares no memory
 * and a table for ten minutes makes no sense.
 */
export function GET(request: Request) {
  const settings = googleSettings()
  const url = new URL(request.url)
  if (!settings) {
    // Without settings the button is not shown; whoever gets here by hand should know why.
    const login = new URL('/login', url.origin)
    login.searchParams.set('chyba', t('auth:google.notConfigured'))
    return redirectResponse(login)
  }

  const state = newOauthState(safeReturnPath(url.searchParams.get('dal')))
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return redirectResponse(authorizationUrl(settings, state), [
    `${OAUTH_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  ])
}
