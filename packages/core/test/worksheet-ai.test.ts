import { NoObjectGeneratedError } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  AI_SETTINGS,
  checkWorksheetItems,
  generateWorksheet,
  regenerateWorksheetItem,
  WORKSHEET_TOO_FEW_MESSAGE,
  type WorksheetCall,
  type WorksheetRequest,
} from '../src/ai'

const MODELY = [{ provider: 'google', model: 'a' } as const]

const ZADANI: WorksheetRequest = {
  title: 'Dýchací soustava',
  subjectName: 'Přírodopis',
  gradeName: '8. ročník',
  materials: '=== plice.txt ===\nPlíce jsou párový orgán. Výměna plynů probíhá v plicních sklípcích.',
  ownText: '',
  instructions: 'víc tabulek, na 20 minut',
}

const otazka = (correctIndex = 1) => ({
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
const tabulka = (rows = [[{ value: 'Plíce', blank: false }, { value: 'výměna plynů', blank: true }]]) => ({
  kind: 'table',
  fromMaterials: true,
  table: { header: ['Orgán', 'Funkce'], rows },
})
const nadpis = { kind: 'heading', text: 'Dýchání', fromMaterials: false }

function fake(answer: unknown, seen: { system?: string; prompt?: string } = {}): WorksheetCall {
  return async ({ system, prompt }) => {
    seen.system = system
    seen.prompt = prompt
    return answer
  }
}

describe('ověření položek od modelu', () => {
  it('vadnou úlohu, tabulku i dlouhý text vyřadí a zbytek nechá', () => {
    const dlouhy = text('x'.repeat(AI_SETTINGS.worksheet.textMax + 1))
    const spatnaTabulka = tabulka([[{ value: 'Plíce', blank: true }]])
    const { items, dropped } = checkWorksheetItems(
      [nadpis, text(), otazka(7), spatnaTabulka, dlouhy, tabulka(), otazka()],
      { hasSource: true },
    )
    expect(dropped).toBe(3)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'text', 'table', 'question'])
  })

  it('tabulku bez prázdné buňky vyřadí — nebylo by co doplňovat', () => {
    const plna = tabulka([[{ value: 'Plíce', blank: false }, { value: 'x', blank: false }]])
    expect(checkWorksheetItems([plna], { hasSource: true }).dropped).toBe(1)
  })

  it('co nevychází z materiálů, dostane značku ověř; nadpis nikdy', () => {
    const { items } = checkWorksheetItems([nadpis, text('Obecná znalost.', false), text()], { hasSource: true })
    expect(items.map((item) => item.needsCheck)).toEqual([false, true, false])
  })

  it('bez materiálů i vlastního textu dostane značku všechno kromě nadpisů a pokynů', () => {
    const pokyn = { kind: 'instruction', text: 'Doplň.', fromMaterials: true }
    const { items } = checkWorksheetItems([nadpis, pokyn, text(), tabulka(), otazka()], { hasSource: false })
    expect(items.map((item) => item.needsCheck)).toEqual([false, false, true, true, true])
  })

  it('uspořádání úlohy na řazení srovná podle správného pořadí', () => {
    const razeni = {
      kind: 'question',
      fromMaterials: true,
      question: {
        type: 'ordering',
        points: 1,
        payload: { prompt: 'Seřaď.', items: ['b', 'a', 'c'], correctOrder: [1, 0, 2] },
      },
    }
    const [item] = checkWorksheetItems([razeni], { hasSource: true }).items
    expect(item?.kind === 'question' && item.question.payload).toMatchObject({ items: ['a', 'b', 'c'] })
  })
})

describe('generování listu', () => {
  it('vrátí list, spočítá vyřazené a zahodí přebytek nad maxItems', async () => {
    const many = Array.from({ length: AI_SETTINGS.worksheet.maxItems + 3 }, (_, i) => text(`Věta ${i}.`))
    const result = await generateWorksheet(ZADANI, {
      models: MODELY,
      callModel: fake({ title: 'Dýchání', items: [otazka(9), ...many] }),
    })
    expect(result.title).toBe('Dýchání')
    expect(result.items).toHaveLength(AI_SETTINGS.worksheet.maxItems)
    expect(result.dropped).toBe(1)
    expect(result.models).toEqual(['google:a'])
  })

  it('při méně než minItems obsahových položkách skončí českou chybou s radou', async () => {
    const call = fake({ title: 'x', items: [nadpis, nadpis, nadpis, text(), otazka(9)] })
    await expect(generateWorksheet(ZADANI, { models: MODELY, callModel: call })).rejects.toThrow(
      WORKSHEET_TOO_FEW_MESSAGE,
    )
    expect(WORKSHEET_TOO_FEW_MESSAGE).toMatch(/znovu/)
  })

  it('odpověď v jiném tvaru zachrání po položkách', async () => {
    const raw = JSON.stringify({ title: 'Zachráněno', items: [text(), funFact, tabulka(), { kind: 'nesmysl' }] })
    const call: WorksheetCall = async () => {
      throw new NoObjectGeneratedError({
        message: 'No object generated: response did not match schema.',
        text: raw,
        response: { id: 'r', timestamp: new Date(), modelId: 'a' },
        usage: {} as never,
        finishReason: 'stop',
      })
    }
    const result = await generateWorksheet(ZADANI, { models: MODELY, callModel: call })
    expect(result.title).toBe('Zachráněno')
    expect(result.items).toHaveLength(3)
    expect(result.dropped).toBe(1)
  })

  it('prompt nese název, ročník, pokyn, vlastní text a pravidlo o přiznání zdroje', async () => {
    const seen: { system?: string; prompt?: string } = {}
    await generateWorksheet(
      { ...ZADANI, ownText: 'Vlastní text učitelky o bránici.' },
      { models: MODELY, callModel: fake({ title: 't', items: [text(), funFact, tabulka()] }, seen) },
    )
    expect(seen.prompt).toContain('Dýchací soustava')
    expect(seen.prompt).toContain('8. ročník')
    expect(seen.prompt).toContain('víc tabulek, na 20 minut')
    expect(seen.prompt).toContain('Vlastní text učitelky o bránici.')
    expect(seen.prompt).toContain('plicních sklípcích')
    expect(`${seen.system}`).toContain('fromMaterials')
  })

  it('dlouhé materiály zkrátí do rozpočtu', async () => {
    const seen: { prompt?: string } = {}
    const dlouhe = `=== a.txt ===\n${'Věta o plicích. '.repeat(10_000)}`
    await generateWorksheet(
      { ...ZADANI, materials: dlouhe },
      { models: MODELY, callModel: fake({ title: 't', items: [text(), funFact, tabulka()] }, seen) },
    )
    expect(seen.prompt!.length).toBeLessThan(AI_SETTINGS.worksheet.materialChars + 5_000)
  })

  it('bez materiálů i textu řekne modelu, že pracuje jen z názvu a ročníku', async () => {
    const seen: { prompt?: string } = {}
    const result = await generateWorksheet(
      { ...ZADANI, materials: '', ownText: '' },
      { models: MODELY, callModel: fake({ title: 't', items: [text(), funFact, tabulka()] }, seen) },
    )
    expect(seen.prompt).toMatch(/žádný text/i)
    expect(result.items.every((item) => item.needsCheck)).toBe(true)
  })
})

describe('přegenerování jednoho kusu', () => {
  it('vrátí jednu položku požadovaného druhu a pošle modelu stávající položky', async () => {
    const seen: { prompt?: string } = {}
    const item = await regenerateWorksheetItem(ZADANI, { kind: 'fun_fact' }, ['Plíce jsou párový orgán.'], {
      models: MODELY,
      callModel: fake({ item: funFact }, seen),
    })
    expect(item).toMatchObject({ kind: 'text', content: { variant: 'fun_fact' }, needsCheck: true })
    expect(seen.prompt).toContain('Plíce jsou párový orgán.')
    expect(seen.prompt).toMatch(/fun fact/i)
  })

  it('úloha musí mít požadovaný typ', async () => {
    const call = fake({ item: otazka() })
    await expect(
      regenerateWorksheetItem(ZADANI, { kind: 'question', questionType: 'true_false' }, [], { models: MODELY, callModel: call }),
    ).rejects.toThrow(/znovu/)
    const ok = await regenerateWorksheetItem(ZADANI, { kind: 'question', questionType: 'single_choice' }, [], {
      models: MODELY,
      callModel: call,
    })
    expect(ok.kind).toBe('question')
  })

  it('položka jiného druhu nebo vadná skončí českou chybou', async () => {
    await expect(
      regenerateWorksheetItem(ZADANI, { kind: 'table' }, [], { models: MODELY, callModel: fake({ item: text() }) }),
    ).rejects.toThrow(/znovu/)
  })
})
