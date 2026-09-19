import { OAUTH_COOKIE } from '@/lib/session'
import {
  bezpecnyNavrat,
  googleNastaveni,
  novyOauthStav,
  presmeruj,
  prihlasovaciAdresa,
} from '@/lib/google'

export const runtime = 'nodejs'

/**
 * Začátek přihlášení přes Google. Stav i tajemství PKCE se ukládají do krátké
 * cookie, ne do databáze: na serverless nemá další požadavek s čím sdílet
 * paměť a zakládat kvůli deseti minutám tabulku nemá smysl.
 */
export function GET(request: Request) {
  const nastaveni = googleNastaveni()
  const url = new URL(request.url)
  if (!nastaveni) {
    // Tlačítko se bez nastavení nezobrazuje; kdo sem trefí ručně, ať ví proč.
    const login = new URL('/login', url.origin)
    login.searchParams.set('chyba', 'Přihlášení přes Google není v této instalaci nastavené.')
    return presmeruj(login)
  }

  const stav = novyOauthStav(bezpecnyNavrat(url.searchParams.get('dal')))
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return presmeruj(prihlasovaciAdresa(nastaveni, stav), [
    `${OAUTH_COOKIE}=${encodeURIComponent(JSON.stringify(stav))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
  ])
}
