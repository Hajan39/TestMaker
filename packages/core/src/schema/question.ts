import { z } from 'zod'
import { blockSchema } from './blocks'

/** Typy otázek podporované aplikací. */
export const QUESTION_TYPES = [
  'open',
  'short_answer',
  'single_choice',
  'multi_choice',
  'true_false',
  'fill_blank',
  'matching',
  'ordering',
  'table_fill',
  'label_image',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  open: 'Volná odpověď',
  short_answer: 'Krátká odpověď',
  single_choice: 'Výběr jedné možnosti',
  multi_choice: 'Výběr více možností',
  true_false: 'Pravda / nepravda',
  fill_blank: 'Doplňování do textu',
  matching: 'Přiřazování dvojic',
  ordering: 'Řazení',
  table_fill: 'Doplňovací tabulka',
  label_image: 'Popis obrázku',
}

/**
 * Typy, které generuje AI v aplikaci. Přiřazování, řazení a doplňování do
 * textu se přidaly, když generování přešlo na Gemini — ten indexy a počty
 * trefuje spolehlivě. `validateQuestionContent` malformované výsledky (index
 * mimo rozsah, opakovaná dvojice, špatný počet vynechaných slov…) i tak
 * zahazuje, takže případné selhání modelu otázku jen zahodí, ne že by prošla
 * do banky rozbitá. Tabulky, volný výběr, výběr více možností a popis
 * obrázku zůstávají pro ruční tvorbu a pro otázky z Claude Code (`/otazky`).
 */
export const AI_QUESTION_TYPES = [
  'single_choice',
  'true_false',
  'short_answer',
  'matching',
  'ordering',
  'fill_blank',
] as const satisfies readonly QuestionType[]

export type AiQuestionType = (typeof AI_QUESTION_TYPES)[number]

/* ------------------------------------------------------------------ payloady */

export const openPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Počet linek na odpověď. */
  lines: z.number().int().min(1).max(20).default(4),
  answer: z.string().min(1),
})

export const shortAnswerPayloadSchema = z.object({
  prompt: z.string().min(3),
  answer: z.string().min(1),
  /** Další uznávané varianty odpovědi. */
  acceptedAnswers: z.array(z.string().min(1)).max(10).default([]),
})

export const singleChoicePayloadSchema = z.object({
  prompt: z.string().min(3),
  options: z.array(z.string().min(1)).min(2).max(8),
  correctIndex: z.number().int().min(0),
})

export const multiChoicePayloadSchema = z.object({
  prompt: z.string().min(3),
  options: z.array(z.string().min(1)).min(3).max(10),
  correctIndices: z.array(z.number().int().min(0)).min(1),
})

export const trueFalsePayloadSchema = z.object({
  prompt: z.string().default('Rozhodni, zda jsou tvrzení pravdivá.'),
  statements: z
    .array(z.object({ text: z.string().min(3), isTrue: z.boolean() }))
    .min(1)
    .max(12),
})

export const fillBlankPayloadSchema = z.object({
  prompt: z.string().default('Doplň chybějící výrazy.'),
  /** Text s místy k doplnění označenými `___` (tři podtržítka). */
  text: z.string().min(5),
  /** Správné výrazy v pořadí výskytu `___`. */
  blanks: z.array(z.string().min(1)).min(1).max(20),
  /** Nabídka slov navíc (volitelná banka výrazů pod zadáním). */
  wordBank: z.array(z.string().min(1)).max(30).default([]),
})

export const matchingPayloadSchema = z.object({
  prompt: z.string().default('Přiřaď k sobě odpovídající dvojice.'),
  left: z.array(z.string().min(1)).min(2).max(12),
  right: z.array(z.string().min(1)).min(2).max(12),
  /**
   * Dvojice [indexVlevo, indexVpravo]. Záměrně pole o dvou prvcích, ne
   * `z.tuple` — z tuple vzniká JSON schéma s `items` jako polem schémat
   * a Google Gemini takové schéma odmítne ("items must be a boolean or an
   * object"). Délku hlídá `.length(2)`.
   */
  pairs: z
    .array(
      z
        .array(z.number().int().min(0))
        .length(2)
        .transform((pair) => pair as [number, number]),
    )
    .min(2),
})

export const orderingPayloadSchema = z.object({
  prompt: z.string().min(3),
  /**
   * Položky. U starších dat (bez `correctOrder`) i pro vykreslení (PDF, klíč
   * odpovědí) platí, že jsou už ve správném pořadí — zamíchá je až tisk.
   */
  items: z.array(z.string().min(1)).min(3).max(12),
  /**
   * Nepovinné: indexy do `items` udávající skutečně správné pořadí. Model si
   * často splete "vypsat položky" a "vypsat je ve správném pořadí" a bez
   * odděleného pole to nejde odhalit ani opravit. Když je vyplněné,
   * `normalizeOrderingPayload` podle něj `items` přeuspořádá a pole samo se
   * před uložením zahodí — na tvar uložených dat i PDF se tím nic nemění.
   */
  correctOrder: z.array(z.number().int().min(0)).min(3).max(12).optional(),
})

export const tableFillPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Hlavičkový řádek tabulky. */
  headers: z.array(z.string()).min(1).max(8),
  /** Řádky; buňka `null` znamená místo k doplnění. */
  rows: z.array(z.array(z.string().nullable()).min(1)).min(1).max(20),
  /** Správné hodnoty pro `null` buňky v pořadí čtení po řádcích. */
  answers: z.array(z.string().min(1)).min(1),
})

export const labelImagePayloadSchema = z.object({
  prompt: z.string().min(3),
  assetId: z.string().min(1),
  /** Popisky očíslovaných míst v obrázku. */
  labels: z.array(z.string().min(1)).min(1).max(20),
})

/* ------------------------------------------------------------------ otázka */

const baseFields = {
  /** Body za otázku; u testu bez známek se nevykreslují. */
  points: z.number().min(0).max(100).default(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** Poznámka do klíče (proč je odpověď správně). */
  explanation: z.string().max(1000).optional(),
  blocks: z.array(blockSchema).max(5).default([]),
  /** Doklad původu: soubor a pasáž, o kterou se otázka opírá. */
  evidence: z
    .object({
      fileName: z.string().min(1),
      /* Délka se neomezuje — validace celého objektu by kvůli jediné otázce
       * shodila celou dávku. Ořez i případ prázdné citace řeší až uložení. */
      quote: z.string(),
    })
    .optional(),
}

export const questionContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), payload: openPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('short_answer'), payload: shortAnswerPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('single_choice'), payload: singleChoicePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('multi_choice'), payload: multiChoicePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('true_false'), payload: trueFalsePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('fill_blank'), payload: fillBlankPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('matching'), payload: matchingPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('ordering'), payload: orderingPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('table_fill'), payload: tableFillPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('label_image'), payload: labelImagePayloadSchema, ...baseFields }),
])

export type QuestionContent = z.infer<typeof questionContentSchema>

/** Nejdelší citace, kterou ukládáme jako doklad původu — delší se ořízne. */
export const MAX_EVIDENCE_QUOTE_LENGTH = 400

/**
 * Přeuspořádá `items` řazené otázky podle `correctOrder`, pokud ho model
 * vyplnil, a `correctOrder` z výsledku odstraní. Volá se před uložením, takže
 * PDF i klíč odpovědí (které pořadí berou přímo z `items`) o novém poli
 * vůbec nemusí vědět a nemusí se kvůli němu měnit.
 */
export function normalizeOrderingPayload(q: QuestionContent): QuestionContent {
  if (q.type !== 'ordering') return q
  const { correctOrder, ...rest } = q.payload
  if (!correctOrder) return q
  // Platnost correctOrder jako permutace indexů items ověřuje validateQuestionContent
  // dřív, než se sem vůbec dostane — tady už jde jen o přeuspořádání.
  return { ...q, payload: { ...rest, items: correctOrder.map((i) => rest.items[i] as string) } }
}

/**
 * Když model vrátí přiřazování s pravým sloupcem ve stejném pořadí jako
 * levý (dvojice `[0,0], [1,1], …`), na papíře by šlo přiřadit bez čtení —
 * stačí spojit řádek s řádkem naproti. Tahle funkce takový případ pozná
 * a pravý sloupec deterministicky posune o jednu pozici (cyklicky), takže
 * žádná položka nezůstane na svém původním místě, ale dvojice pořád
 * odkazují na tytéž věcné páry. Nejde o náhodu — stejný vstup musí dát
 * pokaždé stejný výstup, jinak by se testy i ruční ověření neshodovaly.
 */
export function normalizeMatchingPayload(q: QuestionContent): QuestionContent {
  if (q.type !== 'matching') return q
  const { left, right, pairs } = q.payload
  const n = left.length
  const isIdentity = right.length === n && pairs.length === n && pairs.every(([l, r]) => l === r)
  if (!isIdentity) return q
  const newRight = Array.from({ length: n }, (_, i) => right[(i + 1) % n] as string)
  const newPairs: [number, number][] = Array.from({ length: n }, (_, l) => [l, (l - 1 + n) % n])
  return { ...q, payload: { ...q.payload, right: newRight, pairs: newPairs } }
}

/**
 * Doklad původu z odpovědi modelu na uložitelnou podobu. Schéma délku citace
 * nekontroluje (jedna moc dlouhá nebo krátká citace by jinak shodila celou
 * dávku generování) — ošetří se až tady, při ukládání: prázdná nebo jen
 * z bílých znaků citace znamená chybějící doklad, moc dlouhá se ořízne.
 */
export function normalizeEvidence(
  evidence: QuestionContent['evidence'],
): { fileName: string; quote: string } | null {
  if (!evidence) return null
  const quote = evidence.quote.trim()
  if (!quote) return null
  return {
    fileName: evidence.fileName,
    quote:
      quote.length > MAX_EVIDENCE_QUOTE_LENGTH
        ? `${quote.slice(0, MAX_EVIDENCE_QUOTE_LENGTH).trim()}…`
        : quote,
  }
}

/**
 * Důvody, kvůli kterým učitelka otázku přegeneruje. Každý dodává model do
 * promptu srozumitelnou nápovědu (`hint`) a případně posouvá obtížnost
 * náhrady (`shift`) — „moc těžká"/„moc lehká" jsou jediné dva důvody, které
 * s obtížností hýbou, ostatní ji nechávají beze změny.
 *
 * `rule` je jiná věta než `hint`: `hint` mluví o *téhle* náhradě („Předchozí
 * verze…“), zatímco `rule` je obecné, časově neurčité pravidlo pro *každé*
 * další generování — do něj se předvyplňuje editor pravidla promptu ve
 * Správě (`SpravaScreen`, „Udělat z toho pravidlo"), když správce z častého
 * důvodu přegenerování udělá trvalé pravidlo školy.
 */
export const REGENERATE_REASONS = {
  nesmysl: {
    label: 'Nedává smysl',
    hint: 'Předchozí verze nedávala smysl — zadání musí být jasné a jednoznačné.',
    rule: 'Zadání musí být jasné a jednoznačné.',
    shift: 0,
  },
  moznosti: {
    label: 'Špatné možnosti',
    hint: 'Předchozí verze měla špatné možnosti — právě jedna musí být správná a ostatní věrohodně špatné.',
    rule: 'Právě jedna možnost je správná, ostatní jsou věrohodně špatné.',
    shift: 0,
  },
  mimo: {
    label: 'Odpověď v materiálu není',
    hint: 'Předchozí verze se ptala na něco, co v materiálu není — drž se doslova textu.',
    rule: 'Ptej se jen na to, co v materiálu doslova stojí.',
    shift: 0,
  },
  tezka: {
    label: 'Moc těžká',
    hint: 'Předchozí verze byla na ročník moc těžká.',
    rule: 'Otázky drž spíš na spodní hranici náročnosti ročníku.',
    shift: -1,
  },
  lehka: {
    label: 'Moc lehká',
    hint: 'Předchozí verze byla moc lehká.',
    rule: 'Otázky drž spíš na horní hranici náročnosti ročníku.',
    shift: 1,
  },
  cestina: {
    label: 'Špatná čeština',
    hint: 'Předchozí verze měla chyby v češtině — piš spisovně a jednoduše.',
    rule: 'Piš spisovnou a jednoduchou češtinou bez chyb.',
    shift: 0,
  },
  odkaz: {
    label: 'Odkazuje na materiál',
    hint: 'Předchozí verze odkazovala na materiál — otázka musí stát sama, bez zmínky o textu nebo zdroji.',
    rule: 'Otázka nikdy neodkazuje na materiál, text ani zdroj; stojí sama.',
    shift: 0,
  },
} as const

export type RegenerateReason = keyof typeof REGENERATE_REASONS

export const QUESTION_STATUSES = ['draft', 'approved', 'rejected'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** Otázka načtená z databáze — metadata plus obsah (diskriminovaná unie podle `type`). */
export interface QuestionMeta {
  id: string
  topicId: string | null
  materialId: string | null
  source: 'ai' | 'manual'
  status: QuestionStatus
  createdAt: string
  /**
   * Kořenová otázka, ze které tahle vznikla jako lehčí nebo těžší verze.
   * `null` u kořenové otázky samotné. Verze verze se váže vždycky na kořen,
   * ne na svého bezprostředního předchůdce — jinak by se verze skládaly do
   * řetězu a karta otázky by neuměla ukázat všechny verze pohromadě.
   */
  variantOf: string | null
}

export type Question = QuestionContent & QuestionMeta

/** Výchozí počet bodů podle typu otázky. */
export const DEFAULT_POINTS: Record<QuestionType, number> = {
  open: 3,
  short_answer: 1,
  single_choice: 1,
  multi_choice: 2,
  true_false: 2,
  fill_blank: 2,
  matching: 3,
  ordering: 2,
  table_fill: 3,
  label_image: 3,
}

/* ------------------------------------------------------------------ validace */

/** Doplňková kontrola, kterou samotné zod schéma neumí (indexy, počty). */
export function validateQuestionContent(q: QuestionContent): string[] {
  const errors: string[] = []
  switch (q.type) {
    case 'single_choice':
      if (q.payload.correctIndex >= q.payload.options.length) {
        errors.push('correctIndex mimo rozsah možností')
      }
      break
    case 'multi_choice': {
      const n = q.payload.options.length
      if (q.payload.correctIndices.some((i) => i >= n)) errors.push('correctIndices mimo rozsah')
      if (new Set(q.payload.correctIndices).size !== q.payload.correctIndices.length) {
        errors.push('correctIndices obsahuje duplicity')
      }
      if (q.payload.correctIndices.length === n) errors.push('všechny možnosti nemohou být správné')
      if (q.payload.correctIndices.length < 2) {
        errors.push('multi_choice musí mít aspoň dvě správné možnosti (jinak jde o single_choice)')
      }
      break
    }
    case 'fill_blank': {
      const placeholders = (q.payload.text.match(/___/g) ?? []).length
      if (placeholders !== q.payload.blanks.length) {
        errors.push(`počet ___ (${placeholders}) neodpovídá počtu blanks (${q.payload.blanks.length})`)
      }
      break
    }
    case 'matching': {
      const { left, right, pairs } = q.payload
      if (pairs.some(([l, r]) => l >= left.length || r >= right.length)) {
        errors.push('pairs odkazují mimo rozsah')
      }
      if (new Set(pairs.map(([l]) => l)).size !== pairs.length) {
        errors.push('levý sloupec se v pairs opakuje')
      }
      if (new Set(pairs.map(([, r]) => r)).size !== pairs.length) {
        errors.push('pravý sloupec se v pairs opakuje')
      }
      // Každá položka vlevo musí mít dvojici — jinak na papíře zůstane řádek,
      // který nejde přiřadit k ničemu. Vpravo naopak položek navíc (distraktorů)
      // být může, ty se do pairs prostě nezahrnou.
      if (pairs.length !== left.length) {
        errors.push('každá položka vlevo musí mít dvojici')
      }
      break
    }
    case 'ordering': {
      const { items, correctOrder } = q.payload
      if (new Set(items).size !== items.length) {
        errors.push('items obsahují duplicity')
      }
      if (correctOrder) {
        const inRange = correctOrder.every((i) => i >= 0 && i < items.length)
        const isPermutation = correctOrder.length === items.length && new Set(correctOrder).size === items.length
        if (!inRange || !isPermutation) {
          errors.push('correctOrder není platná permutace indexů items')
        }
      }
      break
    }
    case 'table_fill': {
      const cols = q.payload.headers.length
      if (q.payload.rows.some((r) => r.length !== cols)) {
        errors.push('řádky nemají stejný počet sloupců jako hlavička')
      }
      const blanks = q.payload.rows.flat().filter((c) => c === null).length
      if (blanks !== q.payload.answers.length) {
        errors.push(`počet prázdných buněk (${blanks}) neodpovídá počtu answers (${q.payload.answers.length})`)
      }
      break
    }
    default:
      break
  }

  // Slabší modely rády vrátí výběr z možností schovaný do textu zadání a typ
  // označí jako krátkou odpověď. Na papíře pak stojí „a) … b) … c) …" a pod tím
  // linka na odpověď, přestože to měl být výběr. Do banky takovou otázku pustit
  // nesmíme — je to chyba zadání, ne jen jiná forma.
  if (TYPES_WITHOUT_INLINE_OPTIONS.has(q.type)) {
    const prompt = (q.payload as { prompt?: unknown }).prompt
    if (typeof prompt === 'string' && countInlineOptions(prompt) >= 3) {
      errors.push('zadání obsahuje vypsané možnosti (a), b), c)…) — patří do typu s výběrem, ne sem')
    }
  }

  return errors
}

/** Typy, u kterých se možnosti vypisují zvlášť, takže v zadání nemají co dělat. */
const TYPES_WITHOUT_INLINE_OPTIONS = new Set<QuestionType>([
  'open',
  'short_answer',
  'true_false',
  'fill_blank',
])

/**
 * Kolik značek typu „a)", „B)" nebo „3)" je v textu na začátku výčtu. Hledá se
 * jen za mezerou nebo na začátku řádku, aby se nechytly zkratky uvnitř věty
 * („odpověď a) platí" ano, „např) " ne).
 */
function countInlineOptions(text: string): number {
  const matches = text.match(/(^|[\s(])[a-eA-E1-5][).]\s/g)
  return matches?.length ?? 0
}
