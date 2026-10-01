/**
 * Accounts from the command line. Serves two things the app cannot do:
 * creating the very first manager and unlocking an account nobody can get into.
 *
 *   pnpm --filter @testmaker/web uzivatel -- --email jana@skola.cz --jmeno "Jana" --role spravce
 *   pnpm --filter @testmaker/web uzivatel -- --email jana@skola.cz --heslo
 *   pnpm --filter @testmaker/web uzivatel -- --email ja@skola.cz --role administrator
 *   pnpm --filter @testmaker/web uzivatel -- --email eva@jina.cz --skola jina-skola
 *   pnpm --filter @testmaker/web uzivatel -- --vypis
 *
 * A new account is created in the school given by `--skola` (slug or id), in a
 * new school given by `--nova-skola "Name"`, otherwise in the oldest one. In an
 * empty database the script asks for the first school's name. The
 * `administrator` role can be assigned only here — the app does not offer it.
 *
 * The password is not written into the command (it would stay in the
 * history) but entered after starting. If none is entered, one is generated
 * and printed.
 *
 * There is deliberately no back door into the app like "if there is no
 * account, let anyone in". Such back doors never get removed.
 */
import { createInterface } from 'node:readline/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `.env.local` is loaded by hand — the script does not run inside Next.js. */
function loadEnv(): void {
  const file = resolve(webRoot, '.env.local')
  if (!existsSync(file)) return
  for (const row of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(row.trim())
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return null
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : ''
}

const ROLE = ['ucitelka', 'spravce', 'nahled', 'administrator'] as const
type Role = (typeof ROLE)[number]

async function main(): Promise<void> {
  loadEnv()

  const { asc, eq, or } = await import('drizzle-orm')
  const { db, schools, users } = await import('../src/db/index')
  const { revokeAllSessionsStandalone } = await import('../src/lib/accountService')
  const { generatePassword, hashPassword, checkPasswordStrength } = await import('../src/lib/password')
  const { newId } = await import('../src/lib/ids')
  const { seedTemplates } = await import('../src/db/templates')
  const { slugFromName } = await import('../src/lib/schoolText')

  if (process.argv.includes('--vypis')) {
    const rows = await db
      .select({
        email: users.email,
        name: users.name,
        role: users.role,
        status: users.status,
        school: schools.name,
        slug: schools.slug,
      })
      .from(users)
      .innerJoin(schools, eq(schools.id, users.schoolId))
      .orderBy(asc(users.email))
    if (rows.length === 0) console.log('Žádné účty. Založ prvního správce přepínačem --email.')
    for (const row of rows) {
      console.log(`${row.email}\t${row.role}\t${row.status}\t${row.name} (${row.school}, ${row.slug})`)
    }
    return
  }

  const email = flag('email')?.trim().toLowerCase()
  if (!email) {
    console.error('Chybí --email. Nápověda je v hlavičce souboru scripts/user.ts.')
    process.exit(1)
  }

  const roleSwitcher = flag('role')
  if (roleSwitcher && !ROLE.includes(roleSwitcher as Role)) {
    console.error(`Role musí být jedna z: ${ROLE.join(', ')}.`)
    process.exit(1)
  }
  const role = (roleSwitcher || null) as Role | null

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

  /*
   * The founding account from migration 0011 holds all existing content. The
   * first real manager therefore overwrites it instead of being created next
   * to it — otherwise the library would stay "foreign" and belong to nobody.
   */
  const [founding] = existing
    ? []
    : await db.select().from(users).where(eq(users.id, 'ucet-zakladatelka')).limit(1)

  const prompt = createInterface({ input: process.stdin, output: process.stdout })

  /*
   * School of the new account: `--nova-skola "Name"` creates it, `--skola`
   * picks an existing one, otherwise the oldest is taken. In a completely
   * empty database (clean deployment) it asks for the first school's name and
   * creates it with templates.
   */
  async function createSchool(name: string) {
    let slug = slugFromName(name)
    for (let attempt = 2; (await db.select().from(schools).where(eq(schools.slug, slug)).limit(1)).length; attempt += 1) {
      slug = `${slugFromName(name)}-${attempt}`
    }
    const [created] = await db.insert(schools).values({ id: newId(), name: name, slug }).returning()
    await seedTemplates(db, created!.id)
    console.log(`Založena škola ${name} (${slug}).`)
    return created!
  }

  const schoolSwitcher = flag('skola')
  const newSchool = flag('nova-skola')?.trim()
  let [school] = newSchool
    ? [await createSchool(newSchool)]
    : schoolSwitcher
      ? await db
          .select()
          .from(schools)
          .where(or(eq(schools.slug, schoolSwitcher), eq(schools.id, schoolSwitcher)))
          .limit(1)
      : await db.select().from(schools).orderBy(asc(schools.createdAt)).limit(1)
  if (!school && schoolSwitcher) {
    console.error(`Škola ${schoolSwitcher} se nenašla. Slug i id škol vypíše \`--vypis\`.`)
    prompt.close()
    process.exit(1)
  }
  if (!school) {
    const name = (await prompt.question('V databázi zatím není žádná škola. Název první školy: ')).trim()
    if (!name) {
      console.error('Bez názvu školy účet založit nejde.')
      prompt.close()
      process.exit(1)
    }
    school = await createSchool(name)
  }

  try {
    const name =
      flag('jmeno') ||
      existing?.name ||
      founding?.name ||
      (await prompt.question(`Jméno pro ${email}: `))

    let password: string | null = null
    let generated = false
    if (process.argv.includes('--heslo') || !existing) {
      const entered = (await prompt.question('Heslo (prázdné = vygenerovat): ')).trim()
      if (entered) {
        const problem = checkPasswordStrength(entered)
        if (problem) {
          console.error(problem)
          process.exit(1)
        }
        password = entered
      } else {
        password = generatePassword()
        generated = true
      }
    }

    const passwordHash = password ? await hashPassword(password) : undefined

    if (existing) {
      await db
        .update(users)
        .set({
          name: name,
          ...(role ? { role } : {}),
          ...(passwordHash ? { passwordHash, mustChangePassword: false } : {}),
          status: 'aktivni',
          failedLogins: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, existing.id))
      // A password change or unlock must sign out old devices. A role change
      // too: the role travels in the signed cookie and the gate would keep
      // admitting by the old one until sign-out.
      if (passwordHash || (role && role !== existing.role)) {
        await revokeAllSessionsStandalone(existing.id)
      }
      console.log(`Účet ${email} upraven.`)
    } else if (founding) {
      await db
        .update(users)
        .set({
          email,
          name: name,
          role: role ?? 'spravce',
          passwordHash,
          mustChangePassword: false,
          status: 'aktivni',
        })
        .where(eq(users.id, founding.id))
      console.log(`Zakládající účet přepsán na ${email}; zůstává mu všechen dosavadní obsah.`)
    } else {
      await db.insert(users).values({
        id: newId(),
        schoolId: school.id,
        email,
        name: name,
        role: role ?? 'ucitelka',
        passwordHash,
        status: 'aktivni',
      })
      console.log(`Účet ${email} založen ve škole ${school.name}.`)
    }

    if (generated && password) {
      console.log(`\nHeslo: ${password}\nPředej ho osobně; podruhé se nevypíše.`)
    }
  } finally {
    prompt.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
