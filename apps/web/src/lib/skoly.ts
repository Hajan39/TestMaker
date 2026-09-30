import 'server-only'
import { and, asc, count, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { db, schools, users } from '@/db'
import { nasaditSablony } from '@/db/sablony'
import { newId } from '@/lib/ids'
import { roleJeAdministrator, roleMuzeSpravovat } from '@/lib/role'
import { normalizovatDomenu, slugZNazvu } from '@/lib/skolaText'
import type { Scope } from '@/lib/uzivatel'

/**
 * Školy: úprava vlastní školy správcem, zakládání a úprava libovolné školy
 * administrátorem, přepnutí administrátora do jiné školy. Kdo na školu
 * nemá právo, dostane stejnou odpověď, jako by neexistovala.
 */

export interface SkolaRadek {
  id: string
  name: string
  slug: string
  googleDomain: string | null
  googleAutoJoin: boolean
  pocetUctu: number
}

export interface ZmenySkoly {
  name?: string
  googleDomain?: string | null
  googleAutoJoin?: boolean
}

/** Tělo požadavku na úpravu školy; sdílí ho správa i administrace. */
export const zmenySkolySchema = z.object({
  name: z.string().max(200).optional(),
  googleDomain: z.string().max(200).nullable().optional(),
  googleAutoJoin: z.boolean().optional(),
})

export type VysledekSkoly = { ok: true; id: string } | { ok: false; chyba: string; status: number }

const NENALEZENA: VysledekSkoly = { ok: false, chyba: 'Škola se nenašla.', status: 404 }
const BEZ_NAZVU: VysledekSkoly = { ok: false, chyba: 'Škola musí mít název.', status: 400 }

export { normalizovatDomenu, slugZNazvu } from '@/lib/skolaText'

/** Všechny školy — jen pro administrátora, jinak `null`. */
export async function seznamSkol(scope: Scope): Promise<SkolaRadek[] | null> {
  if (!roleJeAdministrator(scope.role)) return null
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      googleDomain: schools.googleDomain,
      googleAutoJoin: schools.googleAutoJoin,
      pocetUctu: count(users.id),
    })
    .from(schools)
    .leftJoin(users, eq(users.schoolId, schools.id))
    .groupBy(schools.id)
    .orderBy(asc(schools.name))
  return rows
}

/** Založí školu i s vestavěnými šablonami. Jen administrátor. */
export async function zalozitSkolu(scope: Scope, vstup: ZmenySkoly): Promise<VysledekSkoly> {
  if (!roleJeAdministrator(scope.role)) return NENALEZENA
  const name = vstup.name?.trim()
  if (!name) return BEZ_NAZVU
  const googleDomain = normalizovatDomenu(vstup.googleDomain)
  const kolize = await kolizeDomeny(googleDomain, null)
  if (kolize) return kolize

  const id = newId()
  await db.insert(schools).values({
    id,
    name,
    slug: await volnySlug(slugZNazvu(name)),
    googleDomain,
    googleAutoJoin: vstup.googleAutoJoin ?? false,
  })
  await nasaditSablony(db, id)
  return { ok: true, id }
}

/**
 * Úprava školy. Správce smí jen tu, ve které pracuje; administrátor
 * kteroukoli.
 */
export async function upravitSkolu(
  scope: Scope,
  schoolId: string,
  zmeny: ZmenySkoly,
): Promise<VysledekSkoly> {
  const smi = roleJeAdministrator(scope.role) || (roleMuzeSpravovat(scope.role) && schoolId === scope.schoolId)
  if (!smi) return NENALEZENA
  const [skola] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId)).limit(1)
  if (!skola) return NENALEZENA

  const sada: Partial<typeof schools.$inferInsert> = {}
  if (zmeny.name !== undefined) {
    const name = zmeny.name.trim()
    if (!name) return BEZ_NAZVU
    sada.name = name
  }
  if (zmeny.googleDomain !== undefined) {
    const googleDomain = normalizovatDomenu(zmeny.googleDomain)
    const kolize = await kolizeDomeny(googleDomain, schoolId)
    if (kolize) return kolize
    sada.googleDomain = googleDomain
  }
  if (zmeny.googleAutoJoin !== undefined) sada.googleAutoJoin = zmeny.googleAutoJoin

  if (Object.keys(sada).length > 0) {
    await db.update(schools).set(sada).where(eq(schools.id, schoolId))
  }
  return { ok: true, id: schoolId }
}

/**
 * Přepne administrátora do školy. Domovská škola výběr smaže, aby se
 * `activeSchoolId` nedrželo zbytečně. Vrací `false`, když škola není nebo
 * volající není administrátor.
 */
export async function prepnoutSkolu(
  scope: Scope & { domovskaSkolaId: string },
  schoolId: string,
): Promise<boolean> {
  if (!roleJeAdministrator(scope.role)) return false
  const [skola] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId)).limit(1)
  if (!skola) return false
  await db
    .update(users)
    .set({ activeSchoolId: schoolId === scope.domovskaSkolaId ? null : schoolId })
    .where(eq(users.id, scope.userId))
  return true
}

async function kolizeDomeny(googleDomain: string | null, schoolId: string | null): Promise<VysledekSkoly | null> {
  if (!googleDomain) return null
  const [jina] = await db
    .select({ name: schools.name })
    .from(schools)
    .where(
      schoolId
        ? and(eq(schools.googleDomain, googleDomain), ne(schools.id, schoolId))
        : eq(schools.googleDomain, googleDomain),
    )
    .limit(1)
  if (!jina) return null
  return {
    ok: false,
    chyba: `Doména ${googleDomain} už patří škole ${jina.name}. Nejdřív ji tam odeberte.`,
    status: 409,
  }
}

async function volnySlug(zaklad: string): Promise<string> {
  for (let pokus = 1; ; pokus += 1) {
    const slug = pokus === 1 ? zaklad : `${zaklad}-${pokus}`
    const [obsazeny] = await db.select({ id: schools.id }).from(schools).where(eq(schools.slug, slug)).limit(1)
    if (!obsazeny) return slug
  }
}
