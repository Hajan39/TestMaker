import { describe, expect, it } from 'vitest'
import { POST as saveOrder } from '@/app/api/library/poradi/route'
import { db, topics } from '@/db'
import { loadClassTopics, loadLibraryTree } from '@/lib/library'
import { sortTopics } from '@/lib/topicOrder'
import { jsonReq, seedTopic, ACCOUNT } from './helpers'

/**
 * Order of topics within a grade. Without manual intervention the Czech
 * alphabet, taking numbers in the name as numbers — materials often carry the
 * chapter number in the name and the curriculum follows them. Once a teacher
 * reorders the topics, the manual order applies.
 */

const names = (list: { name: string }[]) => list.map((topic) => topic.name)

describe('sortTopics', () => {
  it('sorts in Czech and numbers in the name as numbers', () => {
    const sorted = sortTopics(
      ['10. Savci', 'Čáp bílý', '2. Ptáci', 'Zebra', '1. Úvod', 'cvrček', 'Chroust'].map((name) => ({
        name,
        position: 0,
      })),
    )
    // "ch" is a separate letter after "h" in Czech — Chroust comes after both cvrček and Čáp.
    expect(names(sorted)).toEqual(['1. Úvod', '2. Ptáci', '10. Savci', 'cvrček', 'Čáp bílý', 'Chroust', 'Zebra'])
  })

  it('puts manually placed topics first, new unplaced ones after them alphabetically', () => {
    const sorted = sortTopics([
      { name: 'A nové', position: 0 },
      { name: 'Druhé', position: 2 },
      { name: 'B nové', position: 0 },
      { name: 'První', position: 1 },
    ])
    expect(names(sorted)).toEqual(['První', 'Druhé', 'A nové', 'B nové'])
  })
})

describe('POST /api/library/poradi', () => {
  async function gradeWithTopics(...topicNames: string[]) {
    const { gradeId, topicId } = await seedTopic({ topic: topicNames[0] })
    const ids = [topicId]
    for (const [index, name] of topicNames.slice(1).entries()) {
      const id = `${topicId}-${index}`
      await db.insert(topics).values({ id, schoolId: ACCOUNT.schoolId, gradeId, name })
      ids.push(id)
    }
    return { gradeId, ids }
  }

  it('saves the manual order and both the grade overview and the library tree follow it', async () => {
    const { gradeId, ids } = await gradeWithTopics('A', 'B', 'C')
    const response = await saveOrder(
      jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[2], ids[0], ids[1]] }),
    )
    expect(response.status).toBe(200)

    const grade = await loadClassTopics(ACCOUNT, gradeId)
    expect(names(grade!.topics)).toEqual(['C', 'A', 'B'])
    expect(grade!.manualOrder).toBe(true)

    const tree = await loadLibraryTree(ACCOUNT)
    const node = tree.flatMap((subject) => subject.grades).find((row) => row.id === gradeId)
    expect(names(node!.topics)).toEqual(['C', 'A', 'B'])
  })

  it('without a topic list returns the grade to alphabetical order', async () => {
    const { gradeId, ids } = await gradeWithTopics('A', 'B')
    await saveOrder(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[1], ids[0]] }))

    const response = await saveOrder(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: null }))
    expect(response.status).toBe(200)

    const grade = await loadClassTopics(ACCOUNT, gradeId)
    expect(names(grade!.topics)).toEqual(['A', 'B'])
    expect(grade!.manualOrder).toBe(false)
  })

  it("rejects a list that doesn't match the grade's topics", async () => {
    const { gradeId, ids } = await gradeWithTopics('A', 'B')
    const { topicId: foreign } = await seedTopic({ topic: 'Z jiného ročníku' })

    const missing = await saveOrder(jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[0]] }))
    expect(missing.status).toBe(400)
    const extra = await saveOrder(
      jsonReq('/api/library/poradi', 'POST', { gradeId, topicIds: [ids[0], foreign] }),
    )
    expect(extra.status).toBe(400)
  })

  it('a foreign grade looks like it does not exist', async () => {
    const response = await saveOrder(
      jsonReq('/api/library/poradi', 'POST', { gradeId: 'neexistuje', topicIds: [] }),
    )
    expect(response.status).toBe(404)
  })
})
