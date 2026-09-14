import { Image, Text, View } from '@react-pdf/renderer'
import type { Block } from '../schema/blocks.js'
import type { Question } from '../schema/question.js'
import type { QuestionStyle, TemplateConfig } from '../schema/template.js'
import { displayOrder } from './shuffle.js'
import { LETTERS } from './styles.js'

interface Props {
  question: Question
  style: QuestionStyle
  config: TemplateConfig
  variant: 'A' | 'B'
  assets: Record<string, string>
}

const BORDER = '1pt solid #444'
const LIGHT = '0.6pt solid #999'

/** Tělo otázky — vše pod zadáním: možnosti, linky, tabulky, obrázky. */
export function QuestionBody({ question, style, config, variant, assets }: Props) {
  return (
    <View>
      {question.blocks.map((block, i) => (
        <BlockView key={i} block={block} assets={assets} />
      ))}
      <AnswerArea question={question} style={style} config={config} variant={variant} assets={assets} />
    </View>
  )
}

function BlockView({ block, assets }: { block: Block; assets: Record<string, string> }) {
  if (block.kind === 'image') {
    const src = assets[block.assetId]
    if (!src) return null
    return (
      <View style={{ marginTop: 6, marginBottom: 4, width: `${block.widthPercent}%` }}>
        <Image src={src} />
        {block.caption ? (
          <Text style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{block.caption}</Text>
        ) : null}
      </View>
    )
  }
  return (
    <View style={{ marginTop: 6, marginBottom: 4 }}>
      {block.caption ? <Text style={{ fontSize: 9, marginBottom: 2 }}>{block.caption}</Text> : null}
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
                  {cell.blank ? '' : cell.text}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </View>
  )
}

function AnswerArea({ question, style, config, variant, assets }: Props) {
  switch (question.type) {
    case 'open':
      return <Lines count={question.payload.lines} height={style.answerLineHeight} />

    case 'short_answer':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
          <Text>Odpověď:</Text>
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
              <Text style={{ fontWeight: 'bold' }}>Tvrzení</Text>
            </View>
            <View style={{ width: 44, padding: 4, borderLeft: LIGHT, alignItems: 'center' }}>
              <Text style={{ fontWeight: 'bold' }}>ANO</Text>
            </View>
            <View style={{ width: 44, padding: 4, borderLeft: LIGHT, alignItems: 'center' }}>
              <Text style={{ fontWeight: 'bold' }}>NE</Text>
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
                <Text>{statement.text}</Text>
              </View>
              <View style={{ width: 44, borderLeft: LIGHT }} />
              <View style={{ width: 44, borderLeft: LIGHT }} />
            </View>
          ))}
        </View>
      )

    case 'fill_blank':
      return (
        <View style={{ marginTop: 6 }}>
          <Text style={{ lineHeight: 1.9 }}>{question.payload.text.replace(/___/g, ' ______________ ')}</Text>
          {question.payload.wordBank.length > 0 ? (
            <View style={{ marginTop: 6, padding: 5, border: LIGHT }}>
              <Text style={{ fontSize: 9 }}>Nabídka: {question.payload.wordBank.join(' • ')}</Text>
            </View>
          ) : null}
        </View>
      )

    case 'matching':
      return (
        <View style={{ flexDirection: 'row', marginTop: 6 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            {question.payload.left.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: 5, alignItems: 'flex-start' }}>
                <View style={{ width: 22, height: 14, border: BORDER, marginRight: 6 }} />
                <Text style={{ flex: 1 }}>
                  {i + 1}. {item}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ flex: 1, paddingLeft: 8, borderLeft: LIGHT }}>
            {question.payload.right.map((item, i) => (
              <Text key={i} style={{ marginBottom: 5 }}>
                {LETTERS[i] ?? i + 1}) {item}
              </Text>
            ))}
          </View>
        </View>
      )

    case 'ordering': {
      const order = displayOrder(question, variant)
      return (
        <View style={{ marginTop: 6 }}>
          {order.map((sourceIndex, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 5, alignItems: 'flex-start' }}>
              <View style={{ width: 22, height: 14, border: BORDER, marginRight: 6 }} />
              <Text style={{ flex: 1 }}>{question.payload.items[sourceIndex]}</Text>
            </View>
          ))}
        </View>
      )
    }

    case 'table_fill':
      return (
        <View style={{ marginTop: 6, border: LIGHT }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#f0f0f0', borderBottom: LIGHT }}>
            {question.payload.headers.map((header, i) => (
              <View
                key={i}
                style={{ flex: 1, padding: 4, borderRight: i < question.payload.headers.length - 1 ? LIGHT : undefined }}
              >
                <Text style={{ fontWeight: 'bold' }}>{header}</Text>
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
                  <Text>{cell ?? ''}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )

    case 'label_image': {
      const src = assets[question.payload.assetId]
      return (
        <View style={{ marginTop: 6 }}>
          {src ? <Image src={src} style={{ width: '70%' }} /> : null}
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
      <Text style={{ flex: 1 }}>{option}</Text>
    </View>
  ))

  return (
    <View style={{ marginTop: 2, flexDirection: 'row', flexWrap: 'wrap' }}>{rendered}</View>
  )
}
