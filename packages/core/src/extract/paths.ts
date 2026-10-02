/**
 * Folders whose content is ignored on import.
 * `~BROMIUM` is the cache of an isolated browser — it contains only
 * placeholder files of a few hundred bytes with a .pdf extension, not real
 * documents.
 */
const SKIP_DIR_PATTERNS = [/^~BROMIUM$/i, /^__MACOSX$/, /_files$/i, /^\.\w/]
const SKIP_FILE_PATTERNS = [/^\./, /\.tmp$/i, /^~\$/, /^lu\w+\.tmp$/i]

export const SUPPORTED_EXTENSIONS = ['pdf', 'odp', 'odt', 'ods', 'docx', 'html', 'htm', 'txt', 'md'] as const
/** Older binary formats that cannot be read in the browser. */
/**
 * Photos whose text is read by the model, or by OCR in the browser as a
 * fallback (`apps/web/src/lib/imageText.ts`). SVG is a drawing, not a photo.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif', 'bmp'] as const

export const LEGACY_EXTENSIONS = ['doc', 'ppt', 'xls', 'odm'] as const

/** Skip reason codes; the web maps them to messages. */
export type SkipReason = 'skryty' | 'docasny' | 'systemova-slozka' | 'obrazek' | 'nepodporovany' | 'stary-format'

export interface ParsedPath {
  subject: string
  grade: string | null
  topic: string
  fileName: string
  extension: string
}

/**
 * The CP437 character set some archivers apply to file names stored in UTF-8.
 * The result is a mangled name like `U╠ünikovka savci`.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

/** Returns the CP437 byte for the given character, or -1 if it is not in the set. */
function cp437Byte(char: string): number {
  const code = char.codePointAt(0) ?? -1
  if (code < 0x80) return code
  const index = CP437_HIGH.indexOf(char)
  return index === -1 ? -1 : 0x80 + index
}

/**
 * Repairs a name whose UTF-8 bytes were read as CP437.
 * Returns the converted text only when the conversion succeeds completely.
 */
export function repairMojibake(rawName: string): string {
  // Box-drawing characters do not normally occur in file names and are
  // typical for this mix-up; without them no repair is attempted.
  if (!/[\u2500-\u257f]/.test(rawName)) return rawName

  // CP437 knows only precomposed characters, so decomposed ones (u + umlaut) are composed first.
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
 * macOS stores file names in NFD (ř = r + caron), Windows and Linux in NFC.
 * Without unifying them both regular expressions and name comparisons fail.
 */
export function normalizePath(relativePath: string): string {
  // The repair is tried per path segment — often only some folder is damaged.
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

/** Returns the skip reason, or null if the file should be processed. */
export function skipReason(rawPath: string): SkipReason | null {
  const segments = normalizePath(rawPath).split('/').filter(Boolean)
  const fileName = segments.at(-1) ?? ''
  const dirs = segments.slice(0, -1)

  if (dirs.some((d) => SKIP_DIR_PATTERNS.some((re) => re.test(d)))) return 'systemova-slozka'
  if (SKIP_FILE_PATTERNS.some((re) => re.test(fileName))) {
    return fileName.startsWith('.') ? 'skryty' : 'docasny'
  }

  const ext = fileExtension(fileName)
  // A photo picked on its own is read (a textbook page shot on a phone). Inside
  // a folder it is skipped: textbook folders are full of illustrations, and
  // reading each one would cost a model call for nothing.
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return dirs.length > 0 ? 'obrazek' : null
  if (ext === 'svg') return 'obrazek'
  if ((LEGACY_EXTENSIONS as readonly string[]).includes(ext)) return 'stary-format'
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) return 'nepodporovany'
  return null
}

const GRADE_RE = /^\s*(\d+)\s*\.?\s*(ročník|tř(?:ída|\.)|roc)/i

/** Recognises the grade from a folder name, e.g. "8. ročník", "6.ročník", "VKO 6. třída". Returns stored data ("8. ročník"). */
export function parseGrade(rawSegment: string): string | null {
  const segment = normalizePath(rawSegment)
  const direct = GRADE_RE.exec(segment)
  if (direct) return `${direct[1]}. ročník`
  const embedded = /(\d+)\s*\.?\s*(ročník|tř(?:ída|\.))/i.exec(segment)
  return embedded ? `${embedded[1]}. ročník` : null
}

/** Topic name from the file name: without extension, ordinal prefix or copy suffix. */
export function topicFromFileName(fileName: string): string {
  const base = normalizePath(fileName).replace(/\.[^.]+$/, '')
  return base
    // Ordinal prefix: "11. ", "04.", "6.22 " — a number without a dot stays ("1000 let…").
    .replace(/^\s*\d+(\.\d+)*[.)]\s*(?=\D)/, '')
    .replace(/^\s*\d+(\.\d+)+\s+(?=\D)/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim() || base
}

/**
 * Derives subject / grade / topic from the relative path.
 * The root folder of the selection is ignored if further levels follow.
 */
export function parsePath(rawPath: string): ParsedPath {
  const normalized = normalizePath(rawPath)
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments.at(-1) ?? normalized
  const dirs = segments.slice(0, -1)
  // Drop the selection root (e.g. `sources`) when there is something below it.
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
  // Subfolders below the grade are reflected in the topic name unless already in it.
  const base = topicFromFileName(fileName)
  const extraDirs = subjectParts
    .slice(1)
    .filter((dir) => !base.toLocaleLowerCase('cs').includes(dir.toLocaleLowerCase('cs')))
  const topic = extraDirs.length > 0 ? `${extraDirs.join(' / ')} – ${base}` : base

  return { subject, grade, topic, fileName, extension: fileExtension(fileName) }
}
