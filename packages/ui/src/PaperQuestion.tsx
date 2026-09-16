import type { Block } from '@testmaker/core/schema'
import type { Question, QuestionContent, QuestionStyle } from '@testmaker/core/schema'
import { answerLines } from '@testmaker/core/schema'
import { displayOrder, formatPoints, LETTERS, numberedBlanks, tableBlankNumbers } from '@testmaker/core/pdf/layout'
import { cn } from './cn'

/**
 * Otázka vykreslená tak, jak se vytiskne — číslo, zadání, body a pod tím
 * skutečná odpověďová plocha: linky, možnosti A) B) C), tabulka ANO/NE,
 * dva sloupce u přiřazování, očíslované rámečky u řazení.
 *
 * Vzorem je `QuestionBody.tsx` z `packages/core/src/pdf`: co tam vykresluje
 * `@react-pdf/renderer`, to tady vykresluje prohlížeč. Učitelka se podle toho
 * rozhoduje, jak písemku poskládat, takže se obojí nesmí rozejít — sdílené
 * kousky (číslování mezer, značky buněk, písmena možností) proto obě strany
 * berou z `@testmaker/core/pdf/layout`.
 *
 * Rozměry se zapisují v bodech PDF (pt) přes proměnnou `--paper-pt`, kterou
 * nastavuje `PaperSheet` podle skutečné šířky listu. Tím zůstane poměr písma,
 * okrajů i linek stejný jako na papíře, ať je náhled v okně jakkoli široký.
 * Bez listu (třeba v testech) platí záložní hodnota, tedy zhruba 1 pt = 1,33 px.
 *
 * Klíč se sem nikdy nekreslí: tohle je pohled na to, co dostanou žáci.
 * Vzorovou odpověď ukazuje skladač zvlášť, nad papírem.
 */

/** Rozměr v bodech PDF; `--paper-pt` nastavuje list, jinak platí 96/72 px. */
const pt = (value: number): string => `calc(${value} * var(--paper-pt, 1.3333px))`

/** Výchozí styl otázky — tytéž hodnoty jako `questionStyleSchema` v core. */
const DEFAULT_STYLE: QuestionStyle = {
  spacingBefore: 10,
  optionColumns: 1,
  answerLineHeight: 20,
  boxed: false,
}

/** Paušální výška zástupného obrázku; drží se odhadu v `pdf/estimate.ts`. */
const IMAGE_PLACEHOLDER_HEIGHT = 110

export function PaperQuestion({
  question,
  label,
  points,
  lines,
  style,
  variant = 'A',
  className,
}: {
  question: Question | QuestionContent
  /** Číslo otázky tak, jak se vytiskne („3.“). Prázdné = bez čísla. */
  label?: string
  /** Body vedle zadání; `null` = test není na známky, body se netisknou. */
  points?: number | null
  /** Přepis počtu linek na odpověď u volné odpovědi. */
  lines?: number | null
  /** Styl z šablony; chybějící hodnoty doplní výchozí nastavení. */
  style?: Partial<QuestionStyle>
  variant?: 'A' | 'B'
  className?: string
}) {
  const resolved: QuestionStyle = { ...DEFAULT_STYLE, ...style }
  const prompt = (question.payload as { prompt?: string }).prompt ?? ''

  return (
    <div
      className={cn('text-paper-fg', className)}
      style={{
        marginTop: pt(resolved.spacingBefore),
        border: resolved.boxed ? `1px solid var(--color-paper-line)` : undefined,
        padding: resolved.boxed ? pt(6) : undefined,
      }}
    >
      <div className="flex items-start">
        {label ? <span className="font-bold" style={{ marginRight: pt(5) }}>{label}</span> : null}
        <span className="min-w-0 flex-1 font-bold break-words">{prompt}</span>
        {points != null ? (
          <span className="shrink-0 opacity-70" style={{ fontSize: pt(8), marginLeft: pt(6) }}>
            ({formatPoints(points)} b.)
          </span>
        ) : null}
      </div>
      {question.blocks.map((block, i) => (
        <PaperBlock key={i} block={block} />
      ))}
      <PaperAnswerArea question={question} style={resolved} lines={lines} variant={variant} />
    </div>
  )
}

/** Příloha otázky: tabulka se vykreslí, obrázek zastoupí rámeček s popiskem. */
function PaperBlock({ block }: { block: Block }) {
  if (block.kind === 'image') {
    return (
      <div style={{ marginTop: pt(6), marginBottom: pt(4), width: `${block.widthPercent}%` }}>
        {/* Přílohy se do prohlížeče nestahují (jsou velké a náhled se překresluje
            při každé úpravě) — místo obrázku drží místo rámeček téže výšky. */}
        <div
          className="flex items-center justify-center border border-paper-line opacity-70"
          style={{ height: pt(IMAGE_PLACEHOLDER_HEIGHT), fontSize: pt(8) }}
        >
          obrázek
        </div>
        {block.caption ? (
          <p className="opacity-70" style={{ fontSize: pt(8), marginTop: pt(2) }}>{block.caption}</p>
        ) : null}
      </div>
    )
  }
  return (
    <div style={{ marginTop: pt(6), marginBottom: pt(4) }}>
      {block.caption ? <p style={{ fontSize: pt(9), marginBottom: pt(2) }}>{block.caption}</p> : null}
      <table className="w-full table-fixed border-collapse border border-paper-line">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  colSpan={cell.colSpan ?? 1}
                  className={cn(
                    'border border-paper-line align-top break-words',
                    cell.header && 'bg-paper-shade font-bold',
                  )}
                  style={{ padding: pt(4) }}
                >
                  {cell.blank ? '' : cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaperAnswerArea({
  question,
  style,
  lines,
  variant,
}: {
  question: Question | QuestionContent
  style: QuestionStyle
  lines: number | null | undefined
  variant: 'A' | 'B'
}) {
  switch (question.type) {
    case 'open':
      return (
        <div style={{ marginTop: pt(6) }}>
          {Array.from({ length: answerLines(question, lines ?? null) }, (_, i) => (
            <div
              key={i}
              data-slot="paper-line"
              className="border-b border-paper-line"
              style={{ height: pt(style.answerLineHeight) }}
            />
          ))}
        </div>
      )

    case 'short_answer':
      return (
        <div className="flex items-end" style={{ marginTop: pt(6) }}>
          <span>Odpověď:</span>
          <span
            className="flex-1 border-b border-paper-line"
            style={{ marginLeft: pt(6), height: pt(14) }}
          />
        </div>
      )

    case 'single_choice':
    case 'multi_choice': {
      const marker = question.type === 'single_choice' ? 'letter' : 'box'
      return (
        <ol className="flex flex-wrap" style={{ marginTop: pt(2) }}>
          {question.payload.options.map((option, i) => (
            <li
              key={i}
              className="flex items-start"
              style={{
                marginTop: pt(4),
                width: style.optionColumns === 2 ? '50%' : '100%',
                paddingRight: style.optionColumns === 2 ? pt(8) : undefined,
              }}
            >
              {marker === 'box' ? (
                <span
                  aria-hidden="true"
                  className="shrink-0 border border-paper-fg"
                  style={{ width: pt(9), height: pt(9), marginRight: pt(6), marginTop: pt(1.5) }}
                />
              ) : (
                <span className="shrink-0" style={{ marginRight: pt(4) }}>{LETTERS[i] ?? i + 1})</span>
              )}
              <span className="min-w-0 flex-1 break-words">{option}</span>
            </li>
          ))}
        </ol>
      )
    }

    case 'true_false':
      return (
        <table
          className="w-full table-fixed border-collapse border border-paper-line"
          style={{ marginTop: pt(6) }}
        >
          <thead>
            <tr className="bg-paper-shade">
              <th className="border border-paper-line text-left font-bold" style={{ padding: pt(4) }}>
                Tvrzení
              </th>
              <th className="border border-paper-line font-bold" style={{ padding: pt(4), width: pt(44) }}>
                ANO
              </th>
              <th className="border border-paper-line font-bold" style={{ padding: pt(4), width: pt(44) }}>
                NE
              </th>
            </tr>
          </thead>
          <tbody>
            {question.payload.statements.map((statement, i) => (
              <tr key={i}>
                {/* Číslo tvrzení je i v klíči — bez něj by učitelka při opravování počítala řádky. */}
                <td className="border border-paper-line break-words" style={{ padding: pt(4) }}>
                  {i + 1}. {statement.text}
                </td>
                <td className="border border-paper-line" />
                <td className="border border-paper-line" />
              </tr>
            ))}
          </tbody>
        </table>
      )

    case 'fill_blank':
      return (
        <div style={{ marginTop: pt(6) }}>
          <p className="break-words" style={{ lineHeight: 1.9 }}>
            {numberedBlanks(question.payload.text)}
          </p>
          {question.payload.wordBank.length > 0 ? (
            <div
              className="border border-paper-line break-words"
              style={{ marginTop: pt(6), padding: pt(5), fontSize: pt(9) }}
            >
              Nabídka: {question.payload.wordBank.join(' • ')}
            </div>
          ) : null}
        </div>
      )

    case 'matching':
      return (
        <div style={{ marginTop: pt(6) }}>
          <PaperHint text="Do rámečku napiš písmeno možnosti vpravo, která patří k položce vlevo." />
          <div className="flex">
            <ol className="min-w-0 flex-1" style={{ paddingRight: pt(8) }}>
              {question.payload.left.map((item, i) => (
                <li key={i} className="flex items-start" style={{ marginBottom: pt(5) }}>
                  <span
                    aria-hidden="true"
                    className="shrink-0 border border-paper-fg"
                    style={{ width: pt(22), height: pt(14), marginRight: pt(6) }}
                  />
                  <span className="min-w-0 flex-1 break-words">
                    {i + 1}. {item}
                  </span>
                </li>
              ))}
            </ol>
            <ol className="min-w-0 flex-1 border-l border-paper-line" style={{ paddingLeft: pt(8) }}>
              {question.payload.right.map((item, i) => (
                <li key={i} className="break-words" style={{ marginBottom: pt(5) }}>
                  {LETTERS[i] ?? i + 1}) {item}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )

    case 'ordering': {
      // Položky jsou na papíře zamíchané; totéž pořadí počítá i tisk.
      const order = displayOrder(question, variant)
      return (
        <div style={{ marginTop: pt(6) }}>
          <PaperHint text="Do rámečku napiš pořadové číslo (1, 2, 3, …), v jakém pořadí položky jdou za sebou." />
          <ol>
            {order.map((sourceIndex, i) => (
              <li key={i} className="flex items-start" style={{ marginBottom: pt(5) }}>
                <span
                  aria-hidden="true"
                  className="shrink-0 border border-paper-fg"
                  style={{ width: pt(22), height: pt(14), marginRight: pt(6) }}
                />
                <span className="min-w-0 flex-1 break-words">{question.payload.items[sourceIndex] ?? ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )
    }

    case 'table_fill': {
      const blankNumbers = tableBlankNumbers(question.payload.rows)
      return (
        <table
          className="w-full table-fixed border-collapse border border-paper-line"
          style={{ marginTop: pt(6) }}
        >
          <thead>
            <tr className="bg-paper-shade">
              {question.payload.headers.map((header, i) => (
                <th
                  key={i}
                  className="border border-paper-line text-left font-bold break-words"
                  style={{ padding: pt(4) }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {question.payload.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn('border border-paper-line align-top break-words', !cell && 'opacity-70')}
                    style={{ padding: pt(4) }}
                  >
                    {cell ?? `(${blankNumbers[r]?.[c]})`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    case 'label_image':
      return (
        <div style={{ marginTop: pt(6) }}>
          <div
            className="flex w-[70%] items-center justify-center border border-paper-line opacity-70"
            style={{ height: pt(IMAGE_PLACEHOLDER_HEIGHT), fontSize: pt(8) }}
          >
            obrázek k popisu
          </div>
          <ol>
            {question.payload.labels.map((_, i) => (
              <li key={i} className="flex items-end" style={{ marginTop: pt(4) }}>
                <span>{i + 1}.</span>
                <span
                  className="flex-1 border-b border-paper-line"
                  style={{ marginLeft: pt(6), height: pt(13) }}
                />
              </li>
            ))}
          </ol>
        </div>
      )

    default:
      return null
  }
}

/**
 * Krátký pokyn, jak vyplnit odpověď — týž text jako v PDF. Patří k vykreslení
 * symbolu rámečku, ne k obsahu otázky.
 */
function PaperHint({ text }: { text: string }) {
  return (
    <p className="opacity-70" style={{ fontSize: pt(8), marginBottom: pt(4) }}>
      {text}
    </p>
  )
}
