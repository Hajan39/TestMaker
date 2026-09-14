/** Složky a soubory, které se při importu přeskakují. */
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

export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase()
}

/** Vrátí důvod přeskočení, nebo null pokud se soubor má zpracovat. */
export function skipReason(relativePath: string): SkipReason | null {
  const segments = relativePath.split('/').filter(Boolean)
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
export function parseGrade(segment: string): string | null {
  const direct = GRADE_RE.exec(segment)
  if (direct) return `${direct[1]}. ročník`
  const embedded = /(\d+)\s*\.?\s*(ročník|tř(?:ída|\.))/i.exec(segment)
  return embedded ? `${embedded[1]}. ročník` : null
}

/** Název tématu ze jména souboru: bez přípony, bez pořadového prefixu, bez kopie-suffixu. */
export function topicFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
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
export function parsePath(relativePath: string): ParsedPath {
  const segments = relativePath.split('/').filter(Boolean)
  const fileName = segments.at(-1) ?? relativePath
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
  // Podsložky pod ročníkem se promítnou do názvu tématu.
  const extraDirs = subjectParts.slice(1)
  const base = topicFromFileName(fileName)
  const topic = extraDirs.length > 0 ? `${extraDirs.join(' / ')} – ${base}` : base

  return { subject, grade, topic, fileName, extension: fileExtension(fileName) }
}
