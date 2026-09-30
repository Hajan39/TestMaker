/**
 * Účty z příkazové řádky. Slouží ke dvěma věcem, které z aplikace udělat
 * nejdou: k založení úplně prvního správce a k odemčení účtu, do kterého se
 * nikdo nedostane.
 *
 *   pnpm --filter @testmaker/web uzivatel -- --email jana@skola.cz --jmeno "Jana" --role spravce
 *   pnpm --filter @testmaker/web uzivatel -- --email jana@skola.cz --heslo
 *   pnpm --filter @testmaker/web uzivatel -- --email ja@skola.cz --role administrator
 *   pnpm --filter @testmaker/web uzivatel -- --email eva@jina.cz --skola jina-skola
 *   pnpm --filter @testmaker/web uzivatel -- --vypis
 *
 * Nový účet vznikne ve škole podle `--skola` (slug nebo id), v nové škole
 * podle `--nova-skola "Název"`, jinak v nejstarší. V prázdné databázi se
 * skript na název první školy zeptá. Roli `administrator` jde přidělit jedině tady — v aplikaci se
 * nenabízí.
 *
 * Heslo se nepíše do příkazu (zůstalo by v historii), ale zadává se po
 * spuštění. Když se nezadá, vygeneruje se a vypíše.
 *
 * Vědomě tu není žádná zadní vrátka do aplikace typu „když není žádný účet,
 * pusť kohokoli". Taková vrátka se nikdy neodstraní.
 */
import { createInterface } from 'node:readline/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `.env.local` se načítá ručně — skript neběží uvnitř Next.js. */
function loadEnv(): void {
  const file = resolve(webRoot, '.env.local')
  if (!existsSync(file)) return
  for (const radek of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(radek.trim())
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}

function prepinac(jmeno: string): string | null {
  const index = process.argv.indexOf(`--${jmeno}`)
  if (index < 0) return null
  const hodnota = process.argv[index + 1]
  return hodnota && !hodnota.startsWith('--') ? hodnota : ''
}

const ROLE = ['ucitelka', 'spravce', 'nahled', 'administrator'] as const
type Role = (typeof ROLE)[number]

async function main(): Promise<void> {
  loadEnv()

  const { asc, eq, or } = await import('drizzle-orm')
  const { db, schools, users } = await import('../src/db/index')
  const { odvolatVsechnyRelaceBezRelace } = await import('../src/lib/uctyServis')
  const { vygenerovatHeslo, zahesovat, zkontrolovatSilu } = await import('../src/lib/heslo')
  const { newId } = await import('../src/lib/ids')
  const { nasaditSablony } = await import('../src/db/sablony')
  const { slugZNazvu } = await import('../src/lib/skolaText')

  if (process.argv.includes('--vypis')) {
    const rows = await db
      .select({
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        skola: schools.name,
        slug: schools.slug,
      })
      .from(users)
      .innerJoin(schools, eq(schools.id, users.schoolId))
      .orderBy(asc(users.email))
    if (rows.length === 0) console.log('Žádné účty. Založ prvního správce přepínačem --email.')
    for (const row of rows) {
      console.log(`${row.email}\t${row.role}\t${row.status}\t${row.name} (${row.skola}, ${row.slug})`)
    }
    return
  }

  const email = prepinac('email')?.trim().toLowerCase()
  if (!email) {
    console.error('Chybí --email. Nápověda je v hlavičce souboru scripts/uzivatel.ts.')
    process.exit(1)
  }

  const rolePrepinac = prepinac('role')
  if (rolePrepinac && !ROLE.includes(rolePrepinac as Role)) {
    console.error(`Role musí být jedna z: ${ROLE.join(', ')}.`)
    process.exit(1)
  }
  const role = (rolePrepinac || null) as Role | null

  const [existujici] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  /*
   * Zakládající účet z migrace 0011 drží všechen dosavadní obsah. První
   * skutečný správce ho proto přepíše, místo aby vznikl vedle něj — jinak by
   * knihovna zůstala „cizí" a nikdo by k ní neměl vztah.
   */
  const [zakladajici] = existujici
    ? []
    : await db.select().from(users).where(eq(users.id, 'ucet-zakladatelka')).limit(1)

  const rozhrani = createInterface({ input: process.stdin, output: process.stdout })

  /*
   * Škola nového účtu: `--nova-skola "Název"` ji založí, `--skola` vybere
   * existující, jinak se vezme nejstarší. V úplně prázdné databázi (čisté
   * nasazení) se na název první školy zeptá a založí ji i se šablonami.
   */
  async function zalozitSkolu(nazev: string) {
    let slug = slugZNazvu(nazev)
    for (let pokus = 2; (await db.select().from(schools).where(eq(schools.slug, slug)).limit(1)).length; pokus += 1) {
      slug = `${slugZNazvu(nazev)}-${pokus}`
    }
    const [nova] = await db.insert(schools).values({ id: newId(), name: nazev, slug }).returning()
    await nasaditSablony(db, nova!.id)
    console.log(`Založena škola ${nazev} (${slug}).`)
    return nova!
  }

  const skolaPrepinac = prepinac('skola')
  const novaSkola = prepinac('nova-skola')?.trim()
  let [skola] = novaSkola
    ? [await zalozitSkolu(novaSkola)]
    : skolaPrepinac
      ? await db
          .select()
          .from(schools)
          .where(or(eq(schools.slug, skolaPrepinac), eq(schools.id, skolaPrepinac)))
          .limit(1)
      : await db.select().from(schools).orderBy(asc(schools.createdAt)).limit(1)
  if (!skola && skolaPrepinac) {
    console.error(`Škola ${skolaPrepinac} se nenašla. Slug i id škol vypíše \`--vypis\`.`)
    rozhrani.close()
    process.exit(1)
  }
  if (!skola) {
    const nazev = (await rozhrani.question('V databázi zatím není žádná škola. Název první školy: ')).trim()
    if (!nazev) {
      console.error('Bez názvu školy účet založit nejde.')
      rozhrani.close()
      process.exit(1)
    }
    skola = await zalozitSkolu(nazev)
  }

  try {
    const jmeno =
      prepinac('jmeno') ||
      existujici?.name ||
      zakladajici?.name ||
      (await rozhrani.question(`Jméno pro ${email}: `))

    let heslo: string | null = null
    let vygenerovane = false
    if (process.argv.includes('--heslo') || !existujici) {
      const zadane = (await rozhrani.question('Heslo (prázdné = vygenerovat): ')).trim()
      if (zadane) {
        const problem = zkontrolovatSilu(zadane)
        if (problem) {
          console.error(problem)
          process.exit(1)
        }
        heslo = zadane
      } else {
        heslo = vygenerovatHeslo()
        vygenerovane = true
      }
    }

    const passwordHash = heslo ? await zahesovat(heslo) : undefined

    if (existujici) {
      await db
        .update(users)
        .set({
          name: jmeno,
          ...(role ? { role } : {}),
          ...(passwordHash ? { passwordHash, mustChangePassword: false } : {}),
          status: 'aktivni',
          failedLogins: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, existujici.id))
      // Změna hesla i odemčení musí odhlásit stará zařízení. Změna role taky:
      // role se nese v podepsané cookii a brána by do odhlášení pouštěla podle
      // staré.
      if (passwordHash || (role && role !== existujici.role)) {
        await odvolatVsechnyRelaceBezRelace(existujici.id)
      }
      console.log(`Účet ${email} upraven.`)
    } else if (zakladajici) {
      await db
        .update(users)
        .set({
          email,
          name: jmeno,
          role: role ?? 'spravce',
          passwordHash,
          mustChangePassword: false,
          status: 'aktivni',
        })
        .where(eq(users.id, zakladajici.id))
      console.log(`Zakládající účet přepsán na ${email}; zůstává mu všechen dosavadní obsah.`)
    } else {
      await db.insert(users).values({
        id: newId(),
        schoolId: skola.id,
        email,
        name: jmeno,
        role: role ?? 'ucitelka',
        passwordHash,
        status: 'aktivni',
      })
      console.log(`Účet ${email} založen ve škole ${skola.name}.`)
    }

    if (vygenerovane && heslo) {
      console.log(`\nHeslo: ${heslo}\nPředej ho osobně; podruhé se nevypíše.`)
    }
  } finally {
    rozhrani.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
