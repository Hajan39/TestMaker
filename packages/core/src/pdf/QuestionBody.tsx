import { Image, Text, View } from '@react-pdf/renderer'
import { t } from '../i18n'
import type { Block } from '../schema/blocks'
import type { Question } from '../schema/question'
import type { QuestionStyle, TemplateConfig } from '../schema/template'
import { answerLines } from '../schema/test'
import { numberedBlanks, tableBlankNumbers } from './layout'
import { displayOrder } from './shuffle'
import { LETTERS } from './styles'
import { sanitizeText } from './text'

interface Props {
  question: Question
  style: QuestionStyle
  config: TemplateConfig
  variant: 'A' | 'B'
  assets: Record<string, string>
  /** Answer line count override from the test item; empty = as the question says. */
  linesOverride?: number | null
}

const BORDER = '1pt solid #444'
const LIGHT = '0.6pt solid #999'

/**
 * Image height cap in points (PDF pt). Without it a tall image (e.g. a
 * portrait scanned photo) could take the whole page and push the rest of the
 * question onto the next page, with no way to see that from the data upfront.
 */
const IMAGE_MAX_HEIGHT = 260

/** Question body — everything below the prompt: options, lines, tables, images. */
export function QuestionBody({ question, style, config, variant, assets, linesOverride }: Props) {
  return (
    <View>
      {question.blocks.map((block, i) => (
        <BlockView key={i} block={block} assets={assets} />
      ))}
      <AnswerArea
        question={question}
        style={style}
        config={config}
        variant={variant}
        assets={assets}
        linesOverride={linesOverride}
      />
    </View>
  )
}

function BlockView({ block, assets }: { block: Block; assets: Record<string, string> }) {
  if (block.kind === 'image') {
    const src = assets[block.assetId]
    return (
      <View style={{ marginTop: 6, marginBottom: 4, width: `${block.widthPercent}%` }}>
        {src ? (
          <Image src={src} style={{ maxHeight: IMAGE_MAX_HEIGHT, objectFit: 'contain' }} />
        ) : (
          // A missing attachment used to be skipped silently, leaving an
          // unexplained gap on the printed test. A visible notice is better.
          <View
            style={{
              border: LIGHT,
              padding: 8,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 9, color: '#a33' }}>{t('pdf:question.imageMissing')}</Text>
          </View>
        )}
        {block.caption ? (
          <Text style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{sanitizeText(block.caption)}</Text>
        ) : null}
      </View>
    )
  }
  return (
    <View style={{ marginTop: 6, marginBottom: 4 }}>
      {block.caption ? <Text style={{ fontSize: 9, marginBottom: 2 }}>{sanitizeText(block.caption)}</Text> : null}
      <View style={{ border: LIGHT }}>
        {block.rows.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', borderBottom: r < block.rows.length - 1 ? LIGHT : undefined }}>
            {row.map((cell, c) => (
              <View
                key={c}
                style={{
                  flex: cell.colSpan ?? 1,
                  padding: 4,
                  minHeight: 16,
                  borderRight: c < row.length - 1 ? LIGHT : undefined,
                  backgroundColor: cell.header ? '#f0f0f0' : undefined,
                }}
              >
                <Text style={{ fontWeight: cell.header ? 'bold' : 'normal' }}>
                  {cell.blank ? '' : sanitizeText(cell.text)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function AnswerArea({ question, style, config, variant, assets, linesOverride }: Props) {
  switch (question.type) {
    case 'open':
      return (
        <Lines count={answerLines(question, linesOverride ?? null)} height={style.answerLineHeight} />
      )

    case 'draw':
      // Empty space without lines — the pupil draws into it.
      return (
        <View
          style={{ marginTop: 6, height: answerLines(question, linesOverride ?? null) * style.answerLineHeight }}
        />
      )

    case 'short_answer':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
          <Text>{t('pdf:question.answerLabel')}</Text>
          <View style={{ flex: 1, borderBottom: LIGHT, marginLeft: 6, height: 14 }} />
        </View>
      )

    case 'single_choice':
    case 'multi_choice': {
      const marker = question.type === 'single_choice' ? 'letter' : 'box'
      return (
        <Options options={question.payload.options} columns={style.optionColumns} marker={marker} />
      )
    }

    case 'true_false':
      return (
        <View style={{ marginTop: 6, border: LIGHT }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#f0f0f0', borderBottom: LIGHT }}>
            <View style={{ flex: 1, padding: 4 }}>
              <Text style={{ fontWeight: 'bold' }}>{t('pdf:question.statement')}</Text>
            </View>
            <View style={{ width: 44, padding: 4, borderLeft: LIGHT, alignItems: 'center' }}>
              <Text style={{ fontWeight: 'bold' }}>{t('pdf:yes')}</Text>
            </View>
            <View style={{ width: 44, padding: 4, borderLeft: LIGHT, alignItems: 'center' }}>
              <Text style={{ fontWeight: 'bold' }}>{t('pdf:no')}</Text>
            </View>
          </View>
          {question.payload.statements.map((statement, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                borderBottom: i < question.payload.statements.length - 1 ? LIGHT : undefined,
              }}
            >
              <View style={{ flex: 1, padding: 4 }}>
                {/* The statement number is in the key too — without it the teacher would count rows while grading. */}
                <Text>
                  {i + 1}. {sanitizeText(statement.text)}
                </Text>
              </View>
              <View style={{ width: 44, borderLeft: LIGHT }} />
              <View style={{ width: 44, borderLeft: LIGHT }} />
            </View>
          ))}
        </View>
      )

    case 'fill_blank': {
      // Every blank gets a sequence number in brackets — the key refers to it by
      // the same marks (see `numberedBlanks`, also used by the builder's paper
      // page), so answers need not be matched by their order in the text.
      const text = numberedBlanks(sanitizeText(question.payload.text))
      return (
        <View style={{ marginTop: 6 }}>
          <Text style={{ lineHeight: 1.9 }}>{text}</Text>
          {question.payload.wordBank.length > 0 ? (
            <View style={{ marginTop: 6, padding: 5, border: LIGHT }}>
              <Text style={{ fontSize: 9 }}>
                {t('pdf:question.wordBank', { words: question.payload.wordBank.map(sanitizeText).join(' • ') })}
              </Text>
            </View>
          ) : null}
        </View>
      )
    }

    case 'matching':
      return (
        <View style={{ marginTop: 6 }}>
          <AnswerHint text={t('pdf:question.matchingHint')} />
          <View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              {question.payload.left.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', marginBottom: 5, alignItems: 'flex-start' }}>
                  <View style={{ width: 22, height: 14, border: BORDER, marginRight: 6 }} />
                  <Text style={{ flex: 1 }}>
                    {i + 1}. {sanitizeText(item)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1, paddingLeft: 8, borderLeft: LIGHT }}>
              {question.payload.right.map((item, i) => (
                <Text key={i} style={{ marginBottom: 5 }}>
                  {LETTERS[i] ?? i + 1}) {sanitizeText(item)}
                </Text>
              ))}
            </View>
          </View>
        </View>
      )

    case 'ordering': {
      const order = displayOrder(question, variant)
      return (
        <View style={{ marginTop: 6 }}>
          <AnswerHint text={t('pdf:question.orderingHint')} />
          {order.map((sourceIndex, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 5, alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 14, border: BORDER, marginRight: 6 }} />
              <Text style={{ flex: 1 }}>{sanitizeText(question.payload.items[sourceIndex] ?? '')}</Text>
            </View>
          ))}
        </View>
      )
    }

    case 'table_fill': {
      // Empty cells are numbered in the order of their answers in the key —
      // otherwise they would have to be matched by table position.
      const blankNumbers = tableBlankNumbers(question.payload.rows)
      return (
        <View style={{ marginTop: 6, border: LIGHT }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#f0f0f0', borderBottom: LIGHT }}>
            {question.payload.headers.map((header, i) => (
              <View
                key={i}
                style={{ flex: 1, padding: 4, borderRight: i < question.payload.headers.length - 1 ? LIGHT : undefined }}
              >
                <Text style={{ fontWeight: 'bold' }}>{sanitizeText(header)}</Text>
              </View>
            ))}
          </View>
          {question.payload.rows.map((row, r) => (
            <View
              key={r}
              style={{ flexDirection: 'row', borderBottom: r < question.payload.rows.length - 1 ? LIGHT : undefined }}
            >
              {row.map((cell, c) => (
                <View
                  key={c}
                  style={{ flex: 1, padding: 4, minHeight: 18, borderRight: c < row.length - 1 ? LIGHT : undefined }}
                >
                  <Text style={{ color: cell ? undefined : '#777' }}>
                    {cell ? sanitizeText(cell) : `(${blankNumbers[r]?.[c]})`}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )
    }

    case 'label_image': {
      const src = assets[question.payload.assetId]
      return (
        <View style={{ marginTop: 6 }}>
          {src ? (
            <Image src={src} style={{ width: '70%', maxHeight: IMAGE_MAX_HEIGHT, objectFit: 'contain' }} />
          ) : (
            <View
              style={{
                width: '70%',
                border: LIGHT,
                padding: 8,
                minHeight: 32,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 9, color: '#a33' }}>{t('pdf:question.imageMissing')}</Text>
            </View>
          )}
          {question.payload.labels.map((_, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 }}>
              <Text>{i + 1}.</Text>
              <View style={{ flex: 1, borderBottom: LIGHT, marginLeft: 6, height: 13 }} />
            </View>
          ))}
        </View>
      )
    }

    default:
      return null
  }
}

/**
 * Short hint on how to fill in the answer (a letter or a sequence number) —
 * without it, in matching and ordering the pupil only sees an empty box and
 * has to guess what is expected. It belongs to rendering, not to question
 * data, since it explains the box symbol in general, not a specific question.
 */
function AnswerHint({ text }: { text: string }) {
  return <Text style={{ fontSize: 8, color: '#555', marginBottom: 4 }}>{text}</Text>
}

function Lines({ count, height }: { count: number; height: number }) {
  return (
    <View style={{ marginTop: 6 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ borderBottom: LIGHT, height }} />
      ))}
    </View>
  )
}

function Options({
  options,
  columns,
  marker,
}: {
  options: string[]
  columns: 1 | 2
  marker: 'letter' | 'box'
}) {
  const rendered = options.map((option, i) => (
    <View
      key={i}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginTop: 4,
        width: columns === 2 ? '50%' : '100%',
        paddingRight: columns === 2 ? 8 : 0,
      }}
    >
      {marker === 'box' ? (
        <View style={{ width: 9, height: 9, border: BORDER, marginRight: 6, marginTop: 1.5 }} />
      ) : (
        <Text style={{ marginRight: 4 }}>{LETTERS[i] ?? i + 1})</Text>
      )}
      <Text style={{ flex: 1 }}>{sanitizeText(option)}</Text>
    </View>
  ))

  return (
    <View style={{ marginTop: 2, flexDirection: 'row', flexWrap: 'wrap' }}>{rendered}</View>
  )
}
