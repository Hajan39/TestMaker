import { describe, expect, it } from 'vitest'
import { parseGrade, parsePath, skipReason, topicFromFileName } from '../src/extract/paths'

describe('parseGrade', () => {
  it('rozpozná běžné zápisy ročníku', () => {
    expect(parseGrade('8. ročník')).toBe('8. ročník')
    expect(parseGrade('6.ročník')).toBe('6. ročník')
    expect(parseGrade('VKO 6. třída')).toBe('6. ročník')
    expect(parseGrade('PŘÍRODOPIS')).toBeNull()
  })
})

describe('topicFromFileName', () => {
  it('odstraní příponu, pořadové číslo a kopii', () => {
    expect(topicFromFileName('11. Dýchací soustava.odp')).toBe('Dýchací soustava')
    expect(topicFromFileName('6.22 Měkkýši (Mollusca).odp')).toBe('Měkkýši (Mollusca)')
    expect(topicFromFileName('Stavba zemského tělesa 9 (1).docx')).toBe('Stavba zemského tělesa 9')
    expect(topicFromFileName('Buňka.pdf')).toBe('Buňka')
  })
})

describe('skipReason', () => {
  it('přeskočí systémové, dočasné a nepodporované soubory', () => {
    expect(skipReason('sources/x/__MACOSX/y.pdf')).toBe('systemova-slozka')
    // ~BROMIUM obsahuje jen zástupné soubory izolovaného prohlížeče, ne skutečná PDF.
    expect(skipReason('sources/PŘÍRODOPIS/~BROMIUM/fotosyntéza.pdf')).toBe('systemova-slozka')
    expect(skipReason('sources/PŘÍRODOPIS/7.ročník/lu54246y22.tmp')).toBe('docasny')
    expect(skipReason('sources/.DS_Store')).toBe('skryty')
    expect(skipReason('sources/VKO/omalovánky/vlajka.jpg')).toBe('obrazek')
    expect(skipReason('sources/x/stará prezentace.ppt')).toBe('stary-format')
    expect(skipReason('sources/x/Krystalová stavba - Učebna_files/css2')).toBe('systemova-slozka')
  })

  it('propustí podporované soubory', () => {
    expect(skipReason('sources/PŘÍRODOPIS/8. ročník/Buňka.pdf')).toBeNull()
    expect(skipReason('sources/ZE/ČR.docx')).toBeNull()
  })
})

describe('parsePath', () => {
  it('odvodí předmět, ročník a téma', () => {
    expect(parsePath('sources/PŘÍRODOPIS/8. ročník/11. Dýchací soustava.odp')).toEqual({
      subject: 'PŘÍRODOPIS',
      grade: '8. ročník',
      topic: 'Dýchací soustava',
      fileName: '11. Dýchací soustava.odp',
      extension: 'odp',
    })
  })

  it('zvládne předmět bez ročníku', () => {
    const parsed = parsePath('sources/ZE/04.Podnebí.pdf')
    expect(parsed.subject).toBe('ZE')
    expect(parsed.grade).toBeNull()
    expect(parsed.topic).toBe('Podnebí')
  })

  it('ročník zapsaný v názvu předmětu', () => {
    const parsed = parsePath('sources/VKO 6. třída/Státní svátky – 6.A.odp')
    expect(parsed.subject).toBe('VKO')
    expect(parsed.grade).toBe('6. ročník')
  })

  it('podsložku promítne do názvu tématu', () => {
    const parsed = parsePath('sources/PŘÍRODOPIS/8. ročník/Opakování/Kostra.pdf')
    expect(parsed.grade).toBe('8. ročník')
    expect(parsed.topic).toBe('Opakování – Kostra')
  })
})

describe('normalizace názvů (macOS NFD)', () => {
  const nfd = 'sources/VKO 6. třída/Státní svátky – 6.A.odp'.normalize('NFD')

  it('rozpozná ročník i v NFD zápisu', () => {
    expect(parseGrade('VKO 6. třída'.normalize('NFD'))).toBe('6. ročník')
  })

  it('odvodí předmět a ročník z NFD cesty', () => {
    const parsed = parsePath(nfd)
    expect(parsed.subject).toBe('VKO')
    expect(parsed.grade).toBe('6. ročník')
  })

  it('nezdvojuje název podsložky v tématu', () => {
    const parsed = parsePath('sources/VKO 6. třída/Státní symboly ČR/Státní symboly ČR – omalovánky.pdf')
    expect(parsed.topic).toBe('Státní symboly ČR – omalovánky')
  })
})

describe('poškozené názvy z archivu', () => {
  // UTF-8 bajty názvu přečtené jako CP437 — typický výsledek rozbalení ZIPu.
  const broken = 'sources/PŘÍRODOPIS/únikovka - savci/U╠ünikovka savci/U╠ünikovka Savci barevna╠ü.pdf'

  it('vrátí čitelný název tématu', () => {
    const parsed = parsePath(broken)
    expect(parsed.topic).toContain('Únikovka')
    expect(parsed.topic).not.toContain('╠')
  })

  it('nepoškozené názvy nechá být', () => {
    expect(parsePath('sources/ZE/04.Podnebí.pdf').topic).toBe('Podnebí')
  })
})

describe('poškozený název v rozloženém tvaru', () => {
  it('opraví i zápis, kde je přehláska samostatným znakem', () => {
    const segment = 'U╠ünikovka savci'
    expect(parsePath(`sources/PŘÍRODOPIS/${segment}/list.pdf`).topic).toContain('Únikovka savci')
  })
})
