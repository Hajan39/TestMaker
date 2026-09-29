import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { generatePuzzleWords, PuzzleWordsRequest } from '@testmaker/core/ai'

/**
 * API slov do hlavolamu. Skutečný model se nevolá: `generatePuzzleWords`
 * běží doopravdy (i s kontrolou slov proti materiálu), jen místo modelu
 * dostane podvržené volání, které vrátí `model.words`.
 */

const model = vi.hoisted(() => ({
  words: [] as { word: string; clue: string }[],
  requests: [] as PuzzleWordsRequest[],
  prompts: [] as string[],
}))

vi.mock('@testmaker/core/ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('@testmaker/core/ai')>()
  return {
    ...original,
    isAiConfigured: () => true,
    generatePuzzleWords: (async (request, options) => {
      model.requests.push(request)
      return original.generatePuzzleWords(request, {
        ...options,
        models: [{ provider: 'google', model: 'podvrzeny' }],
        callModel: async ({ prompt }) => {
          model.prompts.push(prompt)
          return { words: model.words }
        },
      })
    }) satisfies typeof generatePuzzleWords,
  }
})

const { GET, POST } = await import('@/app/api/puzzles/words/route')
const { jsonReq, req, seedMaterial, seedTopic } = await import('./helpers')

const TEXT =
  'Potrava putuje z dutiny ústní jícnem do žaludku. Za žaludkem následuje dvanáctník, kam ústí slinivka břišní. ' +
  'Stěna žaludku obsahuje svaly. Játra tvoří žluč. '.repeat(3)

async function topicWithText(): Promise<string> {
  const { topicId } = await seedTopic({ grade: '8. ročník' })
  await seedMaterial(topicId, { text: TEXT })
  return topicId
}

beforeEach(() => {
  model.words = []
  model.requests = []
  model.prompts = []
})

describe('POST /api/puzzles/words', () => {
  it('opraví diakritiku podle materiálu a vrátí počty', async () => {
    const topicId = await topicWithText()
    model.words = [
      { word: 'zaludek', clue: 'Vak, ve kterém se potrava tráví kyselinou.' },
      { word: 'jicen', clue: 'Trubice mezi hltanem a trávicím vakem.' },
      { word: 'hvozdy', clue: 'Tohle v materiálu vůbec není.' },
    ]
    const response = await POST(jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'wordsearch', count: 3 }))
    expect(response.status).toBe(200)
    const data = (await response.json()) as {
      entries: { word: string }[]
      rejected: { word: string; reason: string }[]
      stats: { requested: number; returned: number; usable: number; dropped: number }
    }
    expect(data.entries.map((entry) => entry.word)).toEqual(['žaludek', 'jícen'])
    expect(data.rejected).toEqual([{ word: 'hvozdy', reason: 'v materiálu se nenašlo' }])
    expect(data.stats).toEqual({ requested: 3, returned: 3, usable: 2, dropped: 1 })
  })

  it('bez jediného použitelného slova vrátí varování, ne úspěch', async () => {
    const topicId = await topicWithText()
    model.words = [{ word: 'radovzmena', clue: 'Vymyšlené slovo.' }]
    const response = await POST(jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'wordsearch', count: 5 }))
    expect(response.status).toBe(422)
    const data = (await response.json()) as { error: string; entries: unknown[]; stats: { usable: number } }
    expect(data.entries).toEqual([])
    expect(data.stats.usable).toBe(0)
    expect(data.error).toContain('Zkus to znovu')
  })

  it('dogenerovaná slova se ke konceptu připíšou, nepřepíšou ho', async () => {
    const topicId = await topicWithText()
    model.words = [{ word: 'žaludek', clue: 'Vak, ve kterém se potrava tráví.' }]
    await POST(jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'wordsearch', count: 2 }))
    model.words = [{ word: 'dvanáctník', clue: 'První část tenkého střeva.' }]
    await POST(jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'wordsearch', count: 2, avoid: ['žaludek'] }))

    const draft = await GET(req(`/api/puzzles/words?topicId=${topicId}&kind=wordsearch`))
    const { entries } = (await draft.json()) as { entries: { word: string }[] }
    expect(entries.map((entry) => entry.word)).toEqual(['žaludek', 'dvanáctník'])
  })

  it('větu tajenky předá modelu a slovo bez jejího písmena zahodí', async () => {
    const topicId = await topicWithText()
    model.words = [
      { word: 'jícen', clue: 'Trubice mezi hltanem a trávicím vakem.' },
      { word: 'svaly', clue: 'Díky nim se stěna trávicího vaku hýbe.' },
    ]
    const response = await POST(
      jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'cryptogram', count: 2, phrase: 'jed' }),
    )
    const data = (await response.json()) as {
      entries: { word: string }[]
      rejected: { word: string; reason: string }[]
      missingLetters: string[]
    }
    expect(model.requests[0]?.phrase).toBe('jed')
    expect(model.prompts[0]).toContain('„jed"')
    expect(data.entries.map((entry) => entry.word)).toEqual(['jícen'])
    expect(data.rejected).toEqual([{ word: 'svaly', reason: 'neobsahuje žádné písmeno tajenky' }])
    expect(data.missingLetters).toEqual(['E', 'D'])
  })

  it('velikost mřížky určí nejdelší slovo', async () => {
    const topicId = await topicWithText()
    model.words = [
      { word: 'dvanáctník', clue: 'První část tenkého střeva.' },
      { word: 'jícen', clue: 'Trubice mezi hltanem a trávicím vakem.' },
    ]
    const response = await POST(
      jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'wordsearch', count: 2, cols: 8, rows: 6 }),
    )
    const data = (await response.json()) as { entries: { word: string }[]; rejected: { reason: string }[] }
    expect(data.entries.map((entry) => entry.word)).toEqual(['jícen'])
    expect(data.rejected[0]?.reason).toBe('je delší než 8 písmen')
  })

  it('starý klient bez věty a mřížky projde jako dřív', async () => {
    const topicId = await topicWithText()
    model.words = [{ word: 'žaludek', clue: 'Vak, ve kterém se potrava tráví.' }]
    const response = await POST(
      jsonReq('/api/puzzles/words', 'POST', { topicId, kind: 'cryptogram', count: 2, phrase: '' }),
    )
    expect(response.status).toBe(200)
    expect(model.requests[0]?.phrase).toBeUndefined()
  })
})
