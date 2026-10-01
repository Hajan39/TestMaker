import { describe, expect, it } from 'vitest'
import { parseGrade, parsePath, skipReason, topicFromFileName } from '../src/extract/paths'

describe('parseGrade', () => {
  it('recognises common grade spellings', () => {
    expect(parseGrade('8. ročník')).toBe('8. ročník')
    expect(parseGrade('6.ročník')).toBe('6. ročník')
    expect(parseGrade('VKO 6. třída')).toBe('6. ročník')
    expect(parseGrade('PŘÍRODOPIS')).toBeNull()
  })
})

describe('topicFromFileName', () => {
  it('removes the extension, ordinal number and copy suffix', () => {
    expect(topicFromFileName('11. Dýchací soustava.odp')).toBe('Dýchací soustava')
    expect(topicFromFileName('6.22 Měkkýši (Mollusca).odp')).toBe('Měkkýši (Mollusca)')
    expect(topicFromFileName('Stavba zemského tělesa 9 (1).docx')).toBe('Stavba zemského tělesa 9')
    expect(topicFromFileName('Buňka.pdf')).toBe('Buňka')
  })
})

describe('skipReason', () => {
  it('skips system, temporary and unsupported files', () => {
    expect(skipReason('sources/x/__MACOSX/y.pdf')).toBe('systemova-slozka')
    // ~BROMIUM contains only placeholder files of an isolated browser, not real PDFs.
    expect(skipReason('sources/PŘÍRODOPIS/~BROMIUM/fotosyntéza.pdf')).toBe('systemova-slozka')
    expect(skipReason('sources/PŘÍRODOPIS/7.ročník/lu54246y22.tmp')).toBe('docasny')
    expect(skipReason('sources/.DS_Store')).toBe('skryty')
    expect(skipReason('sources/VKO/omalovánky/vlajka.jpg')).toBe('obrazek')
    expect(skipReason('sources/x/stará prezentace.ppt')).toBe('stary-format')
    expect(skipReason('sources/x/Krystalová stavba - Učebna_files/css2')).toBe('systemova-slozka')
  })

  it('lets supported files through', () => {
    expect(skipReason('sources/PŘÍRODOPIS/8. ročník/Buňka.pdf')).toBeNull()
    expect(skipReason('sources/ZE/ČR.docx')).toBeNull()
  })
})

describe('parsePath', () => {
  it('derives subject, grade and topic', () => {
    expect(parsePath('sources/PŘÍRODOPIS/8. ročník/11. Dýchací soustava.odp')).toEqual({
      subject: 'PŘÍRODOPIS',
      grade: '8. ročník',
      topic: 'Dýchací soustava',
      fileName: '11. Dýchací soustava.odp',
      extension: 'odp',
    })
  })

  it('handles a subject without a grade', () => {
    const parsed = parsePath('sources/ZE/04.Podnebí.pdf')
    expect(parsed.subject).toBe('ZE')
    expect(parsed.grade).toBeNull()
    expect(parsed.topic).toBe('Podnebí')
  })

  it('grade written in the subject name', () => {
    const parsed = parsePath('sources/VKO 6. třída/Státní svátky – 6.A.odp')
    expect(parsed.subject).toBe('VKO')
    expect(parsed.grade).toBe('6. ročník')
  })

  it('reflects a subfolder in the topic name', () => {
    const parsed = parsePath('sources/PŘÍRODOPIS/8. ročník/Opakování/Kostra.pdf')
    expect(parsed.grade).toBe('8. ročník')
    expect(parsed.topic).toBe('Opakování – Kostra')
  })
})

describe('name normalisation (macOS NFD)', () => {
  const nfd = 'sources/VKO 6. třída/Státní svátky – 6.A.odp'.normalize('NFD')

  it('recognises the grade in NFD form too', () => {
    expect(parseGrade('VKO 6. třída'.normalize('NFD'))).toBe('6. ročník')
  })

  it('derives subject and grade from an NFD path', () => {
    const parsed = parsePath(nfd)
    expect(parsed.subject).toBe('VKO')
    expect(parsed.grade).toBe('6. ročník')
  })

  it('does not duplicate the subfolder name in the topic', () => {
    const parsed = parsePath('sources/VKO 6. třída/Státní symboly ČR/Státní symboly ČR – omalovánky.pdf')
    expect(parsed.topic).toBe('Státní symboly ČR – omalovánky')
  })
})

describe('mangled names from an archive', () => {
  // UTF-8 bytes of the name read as CP437 — a typical result of unpacking a ZIP.
  const broken = 'sources/PŘÍRODOPIS/únikovka - savci/U╠ünikovka savci/U╠ünikovka Savci barevna╠ü.pdf'

  it('returns a readable topic name', () => {
    const parsed = parsePath(broken)
    expect(parsed.topic).toContain('Únikovka')
    expect(parsed.topic).not.toContain('╠')
  })

  it('leaves undamaged names alone', () => {
    expect(parsePath('sources/ZE/04.Podnebí.pdf').topic).toBe('Podnebí')
  })
})

describe('mangled name in decomposed form', () => {
  it('also repairs a spelling where the umlaut is a separate character', () => {
    const segment = 'U╠ünikovka savci'
    expect(parsePath(`sources/PŘÍRODOPIS/${segment}/list.pdf`).topic).toContain('Únikovka savci')
  })
})
