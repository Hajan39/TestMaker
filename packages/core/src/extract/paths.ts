/**
 * Složky, jejichž obsah se při importu ignoruje.
 * `~BROMIUM` je cache izolovaného prohlížeče — obsahuje jen několikasetbajtové
 * zástupné soubory s příponou .pdf, ne skutečné dokumenty.
 */
const SKIP_DIR_PATTERNS = [/^~BROMIUM$/i, /^__MACOSX$/, /_files$/i, /^\.\w/]
const SKIP_FILE_PATTERNS = [/^\./, /\.tmp$/i, /^~\$/, /^lu\w+\.tmp$/i]

export const SUPPORTED_EXTENSIONS = ['pdf', 'odp', 'odt', 'ods', 'docx', 'html', 'htm', 'txt', 'md'] as const
/** Starší binární formáty, které v prohlížeči přečíst nelze. */
export const LEGACY_EXTENSIONS = ['doc', 'ppt', 'xls', 'odm'] as const

export type SkipReason = 'skryty' | 'docasny' | 'systemova-slozka' | 'obrazek' | 'nepodporovany' | 'stary-format'

export interface ParsedPath {
  subject: string
  grade: string | null
  topic: string
  fileName: string
  extension: string
}

/**
 * Znaková sada CP437, kterou některé archivační nástroje použijí na názvy
 * souborů uložené v UTF-8. Výsledkem je zmršený název typu `U╠ünikovka savci`.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

/** Vrátí bajt CP437 pro daný znak, nebo -1 pokud v této sadě není. */
function cp437Byte(char: string): number {
  const code = char.codePointAt(0) ?? -1
  if (code < 0x80) return code
  const index = CP437_HIGH.indexOf(char)
  return index === -1 ? -1 : 0x80 + index
}

/**
 * Opraví název, jehož UTF-8 bajty někdo přečetl jako CP437.
 * Vrátí původní text jen tehdy, když se převod povede beze zbytku.
 */
export function repairMojibake(rawName: string): string {
  // Rámečkové znaky se v názvech souborů běžně nevyskytují a jsou pro tuto
  // záměnu typické; bez nich se o opravu nepokoušíme.
  if (!/[\u2500-\u257f]/.test(rawName)) return rawName

  // CP437 zná jen složené znaky, proto se rozložené (u + přehláska) nejdřív složí.
  const name = rawName.normalize('NFC')
  const bytes: number[] = []
  for (const char of name) {
    const byte = cp437Byte(char)
    if (byte === -1) return name
    bytes.push(byte)
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return decoded.includes('\ufffd') ? rawName : decoded
  } catch {
    return rawName
  }
}

/**
 * macOS ukládá názvy souborů v NFD (ř = r + háček), Windows a Linux v NFC.
 * Bez sjednocení selžou jak regulární výrazy, tak porovnávání názvů.
 */
export function normalizePath(relativePath: string): string {
  // Oprava se zkouší po částech cesty — poškozená bývá jen některá složka.
  return relativePath
    .split('/')
    .map((segment) => repairMojibake(segment))
    .join('/')
    .normalize('NFC')
}

export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase()
}

/** Vrátí důvod přeskočení, nebo null pokud se soubor má zpracovat. */
export function skipReason(rawPath: string): SkipReason | null {
  const segments = normalizePath(rawPath).split('/').filter(Boolean)
  const fileName = segments.at(-1) ?? ''
  const dirs = segments.slice(0, -1)

  if (dirs.some((d) => SKIP_DIR_PATTERNS.some((re) => re.test(d)))) return 'systemova-slozka'
  if (SKIP_FILE_PATTERNS.some((re) => re.test(fileName))) {
    return fileName.startsWith('.') ? 'skryty' : 'docasny'
  }

  const ext = fileExtension(fileName)
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return 'obrazek'
  if ((LEGACY_EXTENSIONS as readonly string[]).includes(ext)) return 'stary-format'
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) return 'nepodporovany'
  return null
}

const GRADE_RE = /^\s*(\d+)\s*\.?\s*(ročník|tř(?:ída|\.)|roc)/i

/** Rozpozná ročník ze jména složky, např. "8. ročník", "6.ročník", "VKO 6. třída". */
export function parseGrade(rawSegment: string): string | null {
  const segment = normalizePath(rawSegment)
  const direct = GRADE_RE.exec(segment)
  if (direct) return `${direct[1]}. ročník`
  const embedded = /(\d+)\s*\.?\s*(ročník|tř(?:ída|\.))/i.exec(segment)
  return embedded ? `${embedded[1]}. ročník` : null
}

/** Název tématu ze jména souboru: bez přípony, bez pořadového prefixu, bez kopie-suffixu. */
export function topicFromFileName(fileName: string): string {
  const base = normalizePath(fileName).replace(/\.[^.]+$/, '')
  return base
    // Pořadový prefix: "11. ", "04.", "6.22 " — číslo bez tečky se nechá ("1000 let…").
    .replace(/^\s*\d+(\.\d+)*[.)]\s*(?=\D)/, '')
    .replace(/^\s*\d+(\.\d+)+\s+(?=\D)/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim() || base
}

/**
 * Z relativní cesty odvodí Předmět / Ročník / Téma.
 * Kořenová složka výběru se ignoruje, pokud za ní následují další úrovně.
 */
export function parsePath(rawPath: string): ParsedPath {
  const normalized = normalizePath(rawPath)
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments.at(-1) ?? normalized
  const dirs = segments.slice(0, -1)
  // Kořen výběru (např. `sources`) zahodíme, když pod ním ještě něco je.
  const meaningful = dirs.length > 1 && /^sources?$|^materi/i.test(dirs[0] ?? '') ? dirs.slice(1) : dirs

  let grade: string | null = null
  const subjectParts: string[] = []
  for (const dir of meaningful) {
    const g = parseGrade(dir)
    if (g && !grade) {
      grade = g
      const rest = dir.replace(/\d+\s*\.?\s*(ročník|tř(?:ída|\.))/i, '').trim()
      if (rest && subjectParts.length === 0) subjectParts.push(rest)
      continue
    }
    subjectParts.push(dir)
  }

  const subject = subjectParts[0]?.trim() || 'Nezařazeno'
  // Podsložky pod ročníkem se promítnou do názvu tématu, pokud už v něm nejsou.
  const base = topicFromFileName(fileName)
  const extraDirs = subjectParts
    .slice(1)
    .filter((dir) => !base.toLocaleLowerCase('cs').includes(dir.toLocaleLowerCase('cs')))
  const topic = extraDirs.length > 0 ? `${extraDirs.join(' / ')} – ${base}` : base

  return { subject, grade, topic, fileName, extension: fileExtension(fileName) }
}
