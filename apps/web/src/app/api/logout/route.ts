import { relaceCookie, smazatStarouCookie } from '@/lib/session'
import { aktualniUzivatel, ukoncitRelaci, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/**
 * Odhlášení: relace se v databázi označí za ukončenou a cookie se přepíše
 * prázdnou. Samotné smazání cookie by nestačilo — kdo by si ji uložil, mohl
 * by se s ní vrátit až do vypršení.
 */
export async function POST() {
  const uzivatel = await aktualniUzivatel()
  if (uzivatel && uzivatel.sid !== 'bez-prihlaseni') {
    await ukoncitRelaci(uzivatel.sid)
    await zapsatAudit({
      schoolId: uzivatel.schoolId,
      userId: uzivatel.userId,
      action: 'odhlaseni',
    })
  }

  const response = Response.json({ ok: true })
  response.headers.append('set-cookie', relaceCookie(null))
  response.headers.append('set-cookie', smazatStarouCookie())
  return response
}
