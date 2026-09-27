import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'
import { generateQuestions, type ModelCall } from '../src/ai/generate'
import {
  AI_NOT_CONFIGURED_MESSAGE,
  describeAiConfig,
  describeAiSetup,
  getModel,
  isAiConfigured,
  readAiLadder,
} from '../src/ai/provider'
import type { QuestionContent } from '../src/schema/question'

/**
 * Žebříček modelů. Žádný test tady nesmí volat skutečný model — volání se
 * podstrkuje přes `callModel`, takže se nespotřebuje ani kousek limitu.
 */

const ZADANI = {
  text: 'Koloběh vody v přírodě zahrnuje výpar, srážky a odtok. '.repeat(20),
  topicName: 'Koloběh vody',
  subjectName: 'Přírodopis',
  gradeName: '6. ročník',
  types: ['short_answer'] as const,
  difficulty: 2 as const,
}

/** Použitelná otázka, ať se dávka neodmítne na validaci. */
function otazka(poradi: number): QuestionContent {
  return {
    type: 'short_answer',
    payload: { prompt: `Otázka číslo ${poradi}?`, answer: 'odpověď', acceptedAnswers: [] },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

const VYCERPANY_LIMIT = 'You exceeded your current quota, please check your plan and billing details.'
const CHYBNY_KLIC = 'Anthropic API key is missing.'

/**
 * Podvržené volání modelu: pro každý model říká, co se má stát. Zaznamenává,
 * kolikrát se na který model sáhlo.
 */
function podvrzenyModel(chovani: Record<string, 'odpovi' | string>): {
  call: ModelCall
  volani: string[]
} {
  const volani: string[] = []
  let poradi = 0
  const call: ModelCall = async ({ config }) => {
    const key = describeAiConfig(config)
    volani.push(key)
    const reakce = chovani[key]
    if (reakce !== 'odpovi') throw new Error(reakce ?? 'neznámý model')
    // Dávka po pěti otázkách jako ve skutečném generování.
    return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
  }
  return { call, volani }
}

const PRVNI = { provider: 'google', model: 'a' } as const
const DRUHY = { provider: 'google', model: 'b' } as const

describe('přepnutí na další model při vyčerpaném limitu', () => {
  it('hotové dávky zůstanou a zbytek dogeneruje další model', async () => {
    let volanoPoprve = true
    const ulozeno: { pocet: number; model: string }[] = []
    let poradi = 0

    const call: ModelCall = async ({ config }) => {
      const key = describeAiConfig(config)
      // Prvnímu modelu dojde limit až po první dávce — jako u ostrého běhu,
      // kde se denní kvóta vyčerpá uprostřed tématu.
      if (key === 'google:a') {
        if (volanoPoprve) {
          volanoPoprve = false
          return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
        }
        throw new Error(VYCERPANY_LIMIT)
      }
      return { questions: Array.from({ length: 5 }, () => otazka(++poradi)) }
    }

    const result = await generateQuestions(
      { ...ZADANI, count: 10, types: [...ZADANI.types] },
      {
        models: [PRVNI, DRUHY],
        callModel: call,
        onBatch: (batch, info) => {
          ulozeno.push({ pocet: batch.length, model: info.model })
        },
      },
    )

    expect(result.questions).toHaveLength(10)
    // Práce prvního modelu se nezahodila.
    expect(ulozeno).toEqual([
      { pocet: 5, model: 'google:a' },
      { pocet: 5, model: 'google:b' },
    ])
    // V jednom tématu se míchaly modely a je to vidět ve výsledku.
    expect(result.models).toEqual(['google:a', 'google:b'])
  })

  it('vyčerpaný model se do konce běhu už nezkouší', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT, 'google:b': 'odpovi' })

    const result = await generateQuestions(
      { ...ZADANI, count: 15, types: [...ZADANI.types] },
      { models: [PRVNI, DRUHY], callModel: call },
    )

    expect(result.questions).toHaveLength(15)
    // Tři dávky, ale na vyčerpaný model se sáhlo jen jednou.
    expect(volani.filter((m) => m === 'google:a')).toHaveLength(1)
    expect(volani.filter((m) => m === 'google:b')).toHaveLength(3)
    expect(result.models).toEqual(['google:b'])
  })

  it('u chyby, která není na opakování, se další model nezkouší', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': CHYBNY_KLIC, 'google:b': 'odpovi' })

    await expect(
      generateQuestions({ ...ZADANI, count: 10, types: [...ZADANI.types] }, { models: [PRVNI, DRUHY], callModel: call }),
    ).rejects.toThrow(/API key/)

    expect(volani).toEqual(['google:a'])
  })

  it('když dojde celý žebříček, propadne chyba posledního modelu nahoru', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT, 'google:b': VYCERPANY_LIMIT })

    await expect(
      generateQuestions({ ...ZADANI, count: 10, types: [...ZADANI.types] }, { models: [PRVNI, DRUHY], callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(volani).toEqual(['google:a', 'google:b'])
  })

  it('jediný model bez žebříčku se chová jako dřív: chyba rovnou padá', async () => {
    const { call, volani } = podvrzenyModel({ 'google:a': VYCERPANY_LIMIT })

    await expect(
      generateQuestions({ ...ZADANI, count: 5, types: [...ZADANI.types] }, { models: [PRVNI], callModel: call }),
    ).rejects.toThrow(/quota/)

    expect(volani).toEqual(['google:a'])
  })
})

describe('žebříček bez modelů', () => {
  it('bez jediného modelu skončí srozumitelnou chybou', async () => {
    await expect(
      generateQuestions({ ...ZADANI, count: 1, types: [...ZADANI.types] }, { models: [] }),
    ).rejects.toThrow(/Žádný model/)
  })
})

describe('žebříček modelů z prostředí', () => {
  it('bez AI_MODELS použije výchozí Gemini, když je klíč', () => {
    expect(readAiLadder({ GOOGLE_GENERATIVE_AI_API_KEY: 'g' })).toEqual([
      { provider: 'google', model: 'gemini-flash-latest' },
    ])
  })

  it('bez jediného klíče je generování vypnuté a nic nespadne', () => {
    expect(readAiLadder({})).toEqual([])
    expect(isAiConfigured({})).toBe(false)
  })

  it('drží pořadí z AI_MODELS a přeskočí poskytovatele bez klíče', () => {
    const env = {
      AI_MODELS: 'anthropic:claude-haiku-4-5, google:gemini-flash-latest, openrouter:deepseek/deepseek-chat',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
      OPENROUTER_API_KEY: 'o',
    }
    expect(readAiLadder(env).map(describeAiConfig)).toEqual([
      'google:gemini-flash-latest',
      'openrouter:deepseek/deepseek-chat',
    ])
  })

  it('dvojtečku v názvu modelu nerozdělí', () => {
    expect(readAiLadder({ AI_MODELS: 'openrouter:vendor/model:free', OPENROUTER_API_KEY: 'o' })).toEqual([
      { provider: 'openrouter', model: 'vendor/model:free' },
    ])
  })

  it('neznámého poskytovatele a položku bez předpony vynechá, zbytek funguje', () => {
    const env = {
      AI_MODELS: 'ollama:qwen3:14b, gemini-flash-latest, google:gemini-flash-lite-latest',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g',
    }
    expect(readAiLadder(env)).toEqual([{ provider: 'google', model: 'gemini-flash-lite-latest' }])
  })

  it('stejný model zařadí jen jednou', () => {
    const env = { AI_MODELS: 'google:a, google:a', GOOGLE_GENERATIVE_AI_API_KEY: 'g' }
    expect(readAiLadder(env)).toHaveLength(1)
  })
})

describe('sestavení modelu', () => {
  it('OpenRouter míří na openrouter.ai s klíčem z prostředí', async () => {
    let url = ''
    let auth = ''
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      auth = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(JSON.stringify({ error: { message: 'x' } }), { status: 400 })
    }) as typeof globalThis.fetch
    const model = await getModel({ provider: 'openrouter', model: 'm' }, { env: { OPENROUTER_API_KEY: 'o' }, fetch })
    await generateText({ model, prompt: 'ahoj', maxRetries: 0 }).catch(() => {})
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(auth).toBe('Bearer o')
  })
})

describe('typy otázek pro AI', () => {
  it('úloha se starým typem z fronty generuje jen povolené typy', async () => {
    const prompty: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompty.push(prompt)
      return { questions: [otazka(prompty.length)] }
    }
    await generateQuestions({ ...ZADANI, count: 2, types: ['table_fill', 'short_answer'] }, { models: [PRVNI], callModel: call })
    expect(prompty.join('\n')).not.toContain('table_fill')
    expect(prompty.join('\n')).toContain('short_answer')
  })

  it('bez jediného povoleného typu použije všechny povolené', async () => {
    const prompty: string[] = []
    const call: ModelCall = async ({ prompt }) => {
      prompty.push(prompt)
      return { questions: [otazka(prompty.length)] }
    }
    await generateQuestions({ ...ZADANI, count: 3, types: ['table_fill'] }, { models: [PRVNI], callModel: call })
    expect(prompty.join('\n')).not.toContain('table_fill')
    expect(prompty.join('\n')).toContain('single_choice')
  })
})

describe('kontrola citace při generování', () => {
  it('otázku s citací, která v materiálu není, zahodí a ostatní ponechá', async () => {
    const call: ModelCall = async () => ({
      questions: [
        { ...otazka(1), evidence: { fileName: 'x', quote: 'Koloběh vody v přírodě zahrnuje výpar' } },
        { ...otazka(2), evidence: { fileName: 'x', quote: 'Voda vře při sto stupních.' } },
      ],
    })
    const vysledek = await generateQuestions(
      { ...ZADANI, count: 2, types: [...ZADANI.types] },
      { models: [PRVNI], callModel: call },
    )
    expect(vysledek.questions.map((q) => (q.payload as { prompt: string }).prompt)).toEqual(['Otázka číslo 1?'])
    expect(vysledek.rejected[0]?.errors).toContain('citace v evidence se v materiálu nenašla')
  })
})

describe('duplicity', () => {
  it('stejné zadání lišící se velikostí písmen a interpunkcí uloží jen jednou', async () => {
    const zneni = ['Co je výpar?', 'co je výpar', 'Co je  výpar ?']
    const call: ModelCall = async () => ({
      questions: zneni.map(
        (prompt) =>
          ({ ...otazka(0), payload: { prompt, answer: 'odpověď', acceptedAnswers: [] } }) as QuestionContent,
      ),
    })
    const vysledek = await generateQuestions(
      { ...ZADANI, count: 3, types: [...ZADANI.types] },
      { models: [PRVNI], callModel: call },
    )
    expect(vysledek.questions).toHaveLength(1)
  })

  it('otázku, která už v tématu je, znovu neuloží', async () => {
    const call: ModelCall = async () => ({
      questions: [
        { ...otazka(0), payload: { prompt: 'Co je výpar?', answer: 'odpověď', acceptedAnswers: [] } } as QuestionContent,
      ],
    })
    const vysledek = await generateQuestions(
      { ...ZADANI, count: 1, types: [...ZADANI.types], avoid: ['co je VÝPAR'] },
      { models: [PRVNI], callModel: call },
    )
    expect(vysledek.questions).toHaveLength(0)
  })
})

/**
 * Téma o `pocet` souborech; každý soubor je vlastní úsek (nové záhlaví vždy
 * začíná nový úsek), takže se dá z promptu poznat, který úsek model dostal.
 */
function temaOSouborech(pocet: number): string {
  return Array.from(
    { length: pocet },
    (_, i) => `=== soubor${i}.txt ===\n${`Kapitola číslo ${i} vypráví o vodě a jejím koloběhu v přírodě. `.repeat(25)}`,
  ).join('\n\n')
}

/** Které soubory (úseky) se v promptech objevily. */
function souboryVPromptech(prompty: string[]): number[] {
  return [...new Set(prompty.flatMap((p) => [...p.matchAll(/=== soubor(\d+)\.txt ===/g)].map((m) => Number(m[1]))))].sort(
    (a, b) => a - b,
  )
}

function zaznamovyModel(): { call: ModelCall; prompty: string[] } {
  const prompty: string[] = []
  let poradi = 0
  const call: ModelCall = async ({ prompt }) => {
    prompty.push(prompt)
    // Vrátí přesně tolik otázek, kolik si prompt řekl — jako poslušný model.
    const pocet = Number(/Vytvoř přesně (\d+) otázek/.exec(prompt)?.[1] ?? 0)
    return { questions: Array.from({ length: pocet }, () => otazka(++poradi)) }
  }
  return { call, prompty }
}

describe('výběr úseků při generování', () => {
  it('deset otázek z třiceti úseků stojí jen dvě volání modelu', async () => {
    const { call, prompty } = zaznamovyModel()
    const vysledek = await generateQuestions(
      { ...ZADANI, text: temaOSouborech(30), count: 10, types: [...ZADANI.types] },
      { models: [PRVNI], callModel: call },
    )
    expect(prompty).toHaveLength(2)
    expect(vysledek.questions).toHaveLength(10)
    // Dvě volání, ale ze dvou různých míst materiálu.
    expect(souboryVPromptech(prompty)).toHaveLength(2)
  })

  it('náhrada s citací ze třetího úseku dostane právě třetí úsek', async () => {
    const { call, prompty } = zaznamovyModel()
    await generateQuestions(
      {
        ...ZADANI,
        text: temaOSouborech(10),
        count: 1,
        types: [...ZADANI.types],
        focus: 'Kapitola číslo 2 vypráví o vodě',
      },
      { models: [PRVNI], callModel: call },
    )
    expect(souboryVPromptech(prompty)).toEqual([2])
  })

  it('náhrada s citací, která v materiálu není, dostane úsek podle posunu', async () => {
    const { call, prompty } = zaznamovyModel()
    await generateQuestions(
      {
        ...ZADANI,
        text: temaOSouborech(10),
        count: 1,
        types: [...ZADANI.types],
        focus: 'Tahle věta v materiálu vůbec není.',
        avoid: ['a', 'b', 'c'],
      },
      { models: [PRVNI], callModel: call },
    )
    expect(souboryVPromptech(prompty)).toEqual([3])
  })

  it('dvě doplnění s jinou délkou seznamu „vyhni se" berou jiné úseky', async () => {
    const prvni = zaznamovyModel()
    await generateQuestions(
      { ...ZADANI, text: temaOSouborech(30), count: 10, types: [...ZADANI.types] },
      { models: [PRVNI], callModel: prvni.call },
    )
    const druhy = zaznamovyModel()
    await generateQuestions(
      {
        ...ZADANI,
        text: temaOSouborech(30),
        count: 10,
        types: [...ZADANI.types],
        avoid: Array.from({ length: 10 }, (_, i) => `Existující otázka ${i}?`),
      },
      { models: [PRVNI], callModel: druhy.call },
    )
    const a = souboryVPromptech(prvni.prompty)
    const b = souboryVPromptech(druhy.prompty)
    expect(a).not.toEqual(b)
  })
})

describe('popis nastavení modelů', () => {
  it('funkční nastavení nemá žádné problémy', () => {
    const setup = describeAiSetup({ AI_MODELS: 'google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
    expect(setup.problems).toEqual([])
  })

  it('staré proměnné pojmenuje a pošle do AI_MODELS', () => {
    const setup = describeAiSetup({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://x', ANTHROPIC_AUTH_TOKEN: '' })
    expect(setup.ladder).toEqual([])
    expect(setup.problems).toContain(
      'Proměnná AI_PROVIDER už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
    )
    expect(setup.problems).toContain(
      'Proměnná OLLAMA_BASE_URL už se nepoužívá — model nastav v AI_MODELS (viz .env.example).',
    )
    // Prázdná proměnná se nepočítá — nic nenastavuje.
    expect(setup.problems.join('\n')).not.toContain('ANTHROPIC_AUTH_TOKEN')
  })

  it('položku s neznámým poskytovatelem nebo bez předpony ukáže', () => {
    const setup = describeAiSetup({ AI_MODELS: 'ollama:qwen3:14b, gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.problems).toEqual([
      'Položka „ollama:qwen3:14b" v AI_MODELS nemá známého poskytovatele (google, openrouter, anthropic).',
      'Položka „gemini-flash-latest" v AI_MODELS nemá známého poskytovatele (google, openrouter, anthropic).',
    ])
  })

  it('položku bez klíče ukáže i s názvem proměnné pro klíč', () => {
    const setup = describeAiSetup({ AI_MODELS: 'anthropic:claude-haiku-4-5, google:gemini-flash-latest', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([{ provider: 'google', model: 'gemini-flash-latest' }])
    expect(setup.problems).toEqual(['K položce „anthropic:claude-haiku-4-5" chybí klíč ANTHROPIC_API_KEY.'])
  })

  it('bez AI_MODELS i bez klíče řekne, že chybí klíč k výchozímu modelu', () => {
    expect(describeAiSetup({}).problems).toEqual([
      'K položce „google:gemini-flash-latest" chybí klíč GOOGLE_GENERATIVE_AI_API_KEY.',
    ])
  })

  it('AI_MODELS jen s oddělovači ohlásí, že v něm nic není', () => {
    const setup = describeAiSetup({ AI_MODELS: ' , ', GOOGLE_GENERATIVE_AI_API_KEY: 'g' })
    expect(setup.ladder).toEqual([])
    expect(setup.problems).toEqual(['V AI_MODELS není žádná položka poskytovatel:model.'])
  })

  it('žebříček je týž jako z readAiLadder', () => {
    const env = { AI_MODELS: 'google:a, google:a, openrouter:b', GOOGLE_GENERATIVE_AI_API_KEY: 'g', OPENROUTER_API_KEY: 'o' }
    expect(describeAiSetup(env).ladder).toEqual(readAiLadder(env))
  })

  it('hláška pro nenastavené generování říká, co doplnit', () => {
    expect(AI_NOT_CONFIGURED_MESSAGE).toContain('AI_MODELS')
    expect(AI_NOT_CONFIGURED_MESSAGE).toContain('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(AI_NOT_CONFIGURED_MESSAGE).toContain('OPENROUTER_API_KEY')
    expect(AI_NOT_CONFIGURED_MESSAGE).toContain('ANTHROPIC_API_KEY')
  })
})
