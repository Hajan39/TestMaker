import { describe, expect, it } from 'vitest'
import { POST as ulozitPoradi } from '@/app/api/library/poradi/route'
import { db, topics } from '@/db'
import { loadClassTopics, loadLibraryTree } from '@/lib/library'
import { seraditTemata } from '@/lib/poradiTemat'
import { jsonReq, seedTopic, UCET } from './helpers'

/**
 * Pořadí témat v ročníku. Bez ručního zásahu česká abeceda, která čísla
 * v názvu bere jako čísla — materiály mívají číslo kapitoly v názvu a látka
 * jde po nich. Když učitel/ka témata přeskládá, platí ruční pořadí.
 */

const jmena = (list: { name: string }[]) => list.map((topic) => topic.name)

describe('seraditTemata', () => {
  it('řadí česky a čísla v názvu jako čísla', () => {
    const serazene = seraditTemata(
      ['10. Savci', 'Čáp bílý', '2. Ptáci', 'Zebra', '1. Úvod', 'cvrček', 'Chroust'].map((name) => ({
        name,
        position: 0,
      })),
    )
    // „ch" je v češtině samostatné písmeno za „h" — Chroust patří až za cvrčka i Čápa.
    expect(jmena(serazene)).toEqual(['1. Úvod', '2. Ptáci', '10. Savci', 'cvrček', 'Čáp bílý', 'Chroust', 'Zebra'])
  })

  it('ručně zařazená témata jdou první, nová bez místa za nimi podle abecedy', () => {
    const serazene = seraditTemata([
      { name: 'A nové', position: 0 },
      { name: 'Druhé', position: 2 },
      { name: 'B nové', position: 0 },
      { name: 'První', position: 1 },
    ])
    expect(jmena(serazene)).toEqual(['První', 'Druhé', 'A nové', 'B nové'])
  })
})

describe('POST /api/library/poradi', () => {
  async function tridaSTematy(...nazvy: string[]) {
    const { gradeId, topicId } = await seedTopic({ topic: nazvy[0] })
    const ids = [topicId]
    for (const [index, name] of nazvy.slice(1).entries()) {
      const id = `${topicId}-${index}`
      await db.insert(topics).values({ id, schoolId: UCET.schoolId, gradeId, name })
      ids.push(id)
    }
    return { gradeId, ids }
  }

  it('uloží ruční pořadí a přehled ročníku i strom knihovny se jím řídí', async () => {
    const { gradeId, ids } = await tridaSTematy('A', 'B', 'C')
    const response = await ulozitPoradi(
      jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[2], ids[0], ids[1]] }),
    )
    expect(response.status).toBe(200)

    const trida = await loadClassTopics(UCET, gradeId)
    expect(jmena(trida!.topics)).toEqual(['C', 'A', 'B'])
    expect(trida!.rucniPoradi).toBe(true)

    const strom = await loadLibraryTree(UCET)
    const rocnik = strom.flatMap((subject) => subject.grades).find((grade) => grade.id === gradeId)
    expect(jmena(rocnik!.topics)).toEqual(['C', 'A', 'B'])
  })

  it('bez seznamu témat vrátí ročník k abecedě', async () => {
    const { gradeId, ids } = await tridaSTematy('A', 'B')
    await ulozitPoradi(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[1], ids[0]] }))

    const response = await ulozitPoradi(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: null }))
    expect(response.status).toBe(200)

    const trida = await loadClassTopics(UCET, gradeId)
    expect(jmena(trida!.topics)).toEqual(['A', 'B'])
    expect(trida!.rucniPoradi).toBe(false)
  })

  it('odmítne seznam, který nesedí na témata ročníku', async () => {
    const { gradeId, ids } = await tridaSTematy('A', 'B')
    const { topicId: cizi } = await seedTopic({ topic: 'Z jiného ročníku' })

    const chybi = await ulozitPoradi(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[0]] }))
    expect(chybi.status).toBe(400)
    const navic = await ulozitPoradi(
      jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[0], cizi] }),
    )
    expect(navic.status).toBe(400)
  })

  it('cizí ročník se tváří jako neexistující', async () => {
    const response = await ulozitPoradi(
      jsonReq('/api/library/poradi', 'POST', { gradeId: 'neexistuje', topicIds: [] }),
    )
    expect(response.status).toBe(404)
  })
})
