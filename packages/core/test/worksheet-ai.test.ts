import { NoObjectGeneratedError } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  AI_SETTINGS,
  checkWorksheetItems,
  generateWorksheet,
  regenerateWorksheetItem,
  worksheetTooFewMessage,
  type AiCallEvent,
  type WorksheetCall,
  type WorksheetRequest,
} from '../src/ai'

const MODELS = [{ provider: 'google', model: 'a' } as const]

const REQUEST: WorksheetRequest = {
  title: 'Dýchací soustava',
  subjectName: 'Přírodopis',
  gradeName: '8. ročník',
  materials: '=== plice.txt ===\nPlíce jsou párový orgán. Výměna plynů probíhá v plicních sklípcích.',
  ownText: '',
  instructions: 'víc tabulek, na 20 minut',
}

const question = (correctIndex = 1) => ({
  kind: 'question',
  fromMaterials: true,
  question: {
    type: 'single_choice',
    points: 1,
    payload: { prompt: 'Kde probíhá výměna plynů?', options: ['V průdušnici', 'V plicních sklípcích'], correctIndex },
  },
})
const text = (value = 'Plíce jsou párový orgán.', fromMaterials = true) => ({
  kind: 'text',
  variant: 'text',
  text: value,
  fromMaterials,
})
const funFact = { kind: 'text', variant: 'fun_fact', text: 'Plíce mají plochu tenisového kurtu.', fromMaterials: false }
const table = (rows = [[{ value: 'Plíce', blank: false }, { value: 'výměna plynů', blank: true }]]) => ({
  kind: 'table',
  fromMaterials: true,
  table: { header: ['Orgán', 'Funkce'], rows },
})
const heading = { kind: 'heading', text: 'Dýchání', fromMaterials: false }

function fake(answer: unknown, seen: { system?: string; prompt?: string } = {}): WorksheetCall {
  return async ({ system, prompt }) => {
    seen.system = system
    seen.prompt = prompt
    return answer
  }
}

describe('verifying items from the model', () => {
  it('drops a broken task, table and long text and keeps the rest', () => {
    const longText = text('x'.repeat(AI_SETTINGS.worksheet.textMax + 1))
    const badTable = table([[{ value: 'Plíce', blank: true }]])
    const { items, dropped } = checkWorksheetItems(
      [heading, text(), question(7), badTable, longText, table(), question()],
      { hasSource: true },
    )
    expect(dropped).toBe(3)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'table', 'question'])
  })

  it('drops a table without a blank cell — there would be nothing to fill in', () => {
    const filled = table([[{ value: 'Plíce', blank: false }, { value: 'x', blank: false }]])
    expect(checkWorksheetItems([filled], { hasSource: true }).dropped).toBe(1)
  })

  it('what is not based on the materials gets the check flag; a heading never', () => {
    const { items } = checkWorksheetItems([heading, text('Obecná znalost.', false), text()], { hasSource: true })
    expect(items.map((item) => item.needsCheck)).toEqual([false, true, false])
  })

  it('without materials and own text everything except headings and instructions gets the flag', () => {
    const instruction = { kind: 'instruction', text: 'Doplň.', fromMaterials: true }
    const { items } = checkWorksheetItems([heading, instruction, text(), table(), question()], { hasSource: false })
    expect(items.map((item) => item.needsCheck)).toEqual([false, false, true, true, true])
  })

  it('reorders an ordering task by the correct order', () => {
    const sorting = {
      kind: 'question',
      fromMaterials: true,
      question: {
        type: 'ordering',
        points: 1,
        payload: { prompt: 'Seřaď.', items: ['b', 'a', 'c'], correctOrder: [1, 0, 2] },
      },
    }
    const [item] = checkWorksheetItems([sorting], { hasSource: true }).items
    expect(item?.kind === 'question' && item.question.payload).toMatchObject({ items: ['a', 'b', 'c'] })
  })
})

describe('generating a worksheet', () => {
  it('returns the worksheet, counts dropped items and discards the excess over maxItems', async () => {
    const many = Array.from({ length: AI_SETTINGS.worksheet.maxItems + 3 }, (_, i) => text(`Věta ${i}.`))
    const result = await generateWorksheet(REQUEST, {
      models: MODELS,
      callModel: fake({ title: 'Dýchání', items: [question(9), ...many] }),
    })
    expect(result.title).toBe('Dýchání')
    expect(result.items).toHaveLength(AI_SETTINGS.worksheet.maxItems)
    expect(result.dropped).toBe(1)
    expect(result.models).toEqual(['google:a'])
  })

  it('skips a heading and an instruction at the end of the worksheet (also after trimming)', async () => {
    const instruction = { kind: 'instruction', text: 'Doplň.', fromMaterials: false }
    const result = await generateWorksheet(REQUEST, {
      models: MODELS,
      callModel: fake({ title: 't', items: [text(), funFact, table(), heading, instruction] }),
    })
    expect(result.items.map((item) => item.kind)).toEqual(['text', 'text', 'table'])
  })

  it('the too-few-items error says how many the model broke', async () => {
    const call = fake({ title: 'x', items: [text(), question(9), question(9)] })
    await expect(generateWorksheet(REQUEST, { models: MODELS, callModel: call })).rejects.toThrow(
      '2 položky byly vadné',
    )
  })

  it('passes the call attempt with tokens to the onCall listener', async () => {
    const events: AiCallEvent[] = []
    const call: WorksheetCall = async ({ meter }) => {
      meter?.usage(1200, 300)
      return { title: 't', items: [text(), funFact, table()] }
    }
    await generateWorksheet(REQUEST, { models: MODELS, callModel: call, onCall: (event) => events.push(event) })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ model: 'google:a', outcome: 'ok', inputTokens: 1200, outputTokens: 300 })
  })

  it('with fewer than minItems content items it ends with a Czech error with advice', async () => {
    const call = fake({ title: 'x', items: [heading, heading, heading, text(), question(9)] })
    await expect(generateWorksheet(REQUEST, { models: MODELS, callModel: call })).rejects.toThrow(
      worksheetTooFewMessage(),
    )
    expect(worksheetTooFewMessage()).toMatch(/znovu/)
  })

  it('salvages an answer in another shape item by item', async () => {
    const raw = JSON.stringify({ title: 'Zachráněno', items: [text(), funFact, table(), { kind: 'nesmysl' }] })
    const call: WorksheetCall = async () => {
      throw new NoObjectGeneratedError({
        message: 'No object generated: response did not match schema.',
        text: raw,
        response: { id: 'r', timestamp: new Date(), modelId: 'a' },
        usage: {} as never,
        finishReason: 'stop',
      })
    }
    const result = await generateWorksheet(REQUEST, { models: MODELS, callModel: call })
    expect(result.title).toBe('Zachráněno')
    expect(result.items).toHaveLength(3)
    expect(result.dropped).toBe(1)
  })

  it('the prompt carries the title, grade, instruction, own text and the source disclosure rule', async () => {
    const seen: { system?: string; prompt?: string } = {}
    await generateWorksheet(
      { ...REQUEST, ownText: 'Vlastní text učitelky o bránici.' },
      { models: MODELS, callModel: fake({ title: 't', items: [text(), funFact, table()] }, seen) },
    )
    expect(seen.prompt).toContain('Dýchací soustava')
    expect(seen.prompt).toContain('8. ročník')
    expect(seen.prompt).toContain('víc tabulek, na 20 minut')
    expect(seen.prompt).toContain('Vlastní text učitelky o bránici.')
    expect(seen.prompt).toContain('plicních sklípcích')
    expect(`${seen.system}`).toContain('fromMaterials')
  })

  it('keeps to the materials by default and may invent only when allowed', async () => {
    const strict: { prompt?: string } = {}
    await generateWorksheet(REQUEST, { models: MODELS, callModel: fake({ title: 't', items: [text(), funFact, table()] }, strict) })
    expect(strict.prompt).toContain('Vycházej výhradně z dodaného textu')

    const free: { prompt?: string } = {}
    await generateWorksheet(
      { ...REQUEST, onlyMaterials: false },
      { models: MODELS, callModel: fake({ title: 't', items: [text(), funFact, table()] }, free) },
    )
    expect(free.prompt).toContain('vymyšlené situace')
    expect(free.prompt).not.toContain('Vycházej výhradně z dodaného textu')
  })

  it('trims long materials to the budget', async () => {
    const seen: { prompt?: string } = {}
    const longText = `=== a.txt ===\n${'Věta o plicích. '.repeat(10_000)}`
    await generateWorksheet(
      { ...REQUEST, materials: longText },
      { models: MODELS, callModel: fake({ title: 't', items: [text(), funFact, table()] }, seen) },
    )
    expect(seen.prompt!.length).toBeLessThan(AI_SETTINGS.worksheet.materialChars + 5_000)
  })

  it('without materials and text it tells the model it works only from the title and grade', async () => {
    const seen: { prompt?: string } = {}
    const result = await generateWorksheet(
      { ...REQUEST, materials: '', ownText: '' },
      { models: MODELS, callModel: fake({ title: 't', items: [text(), funFact, table()] }, seen) },
    )
    expect(seen.prompt).toMatch(/žádný text/i)
    expect(result.items.every((item) => item.needsCheck)).toBe(true)
  })
})

describe('regenerating a single item', () => {
  it('returns one item of the requested kind and sends the existing items to the model', async () => {
    const seen: { prompt?: string } = {}
    const item = await regenerateWorksheetItem(REQUEST, { kind: 'fun_fact' }, ['Plíce jsou párový orgán.'], {
      models: MODELS,
      callModel: fake({ item: funFact }, seen),
    })
    expect(item).toMatchObject({ kind: 'text', content: { variant: 'fun_fact' }, needsCheck: true })
    expect(seen.prompt).toContain('Plíce jsou párový orgán.')
    expect(seen.prompt).toMatch(/fun fact/i)
  })

  it('a task must have the requested type', async () => {
    const call = fake({ item: question() })
    await expect(
      regenerateWorksheetItem(REQUEST, { kind: 'question', questionType: 'true_false' }, [], { models: MODELS, callModel: call }),
    ).rejects.toThrow(/znovu/)
    const ok = await regenerateWorksheetItem(REQUEST, { kind: 'question', questionType: 'single_choice' }, [], {
      models: MODELS,
      callModel: call,
    })
    expect(ok.kind).toBe('question')
  })

  it('an item of another kind or a broken one ends with a Czech error', async () => {
    await expect(
      regenerateWorksheetItem(REQUEST, { kind: 'table' }, [], { models: MODELS, callModel: fake({ item: text() }) }),
    ).rejects.toThrow(/znovu/)
  })
})
