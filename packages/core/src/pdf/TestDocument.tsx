import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Question } from '../schema/question.js'
import { resolveQuestionStyle, type TemplateConfig } from '../schema/template.js'
import type { RenderableTest, ResolvedTestItem } from '../schema/test.js'
import { formatAnswer } from './answerKey.js'
import { QuestionBody } from './QuestionBody.js'
import { buildVariant } from './shuffle.js'
import { pagePadding, questionLabel } from './styles.js'

const LIGHT = '0.6pt solid #999'

/** Jeden generický dokument řízený `template.config` — žádná šablona není hard-coded. */
export function TestDocument({ test, template, items, variant, withKey, assets }: RenderableTest) {
  const config = template.config
  const ordered = buildVariant(items, variant, test.id)
  const questions = ordered.filter((i) => i.kind === 'question' && i.question)
  const total = questions.reduce(
    (sum, i) => sum + (i.pointsOverride ?? i.question?.points ?? 0),
    0,
  )

  let questionIndex = -1

  return (
    <Document title={test.title} author={test.header.teacher || undefined}>
      <Page
        size="A4"
        style={{
          ...pagePadding(config),
          fontFamily: config.page.fontFamily,
          fontSize: config.page.fontSize,
          lineHeight: config.page.lineHeight,
          color: '#111',
        }}
      >
        {config.header.show ? (
          <Header test={test} config={config} totalPoints={total} variant={variant} />
        ) : null}

        {ordered.map((item) => {
          if (item.kind === 'question' && item.question) {
            questionIndex += 1
            return (
              <QuestionView
                key={item.id}
                item={item}
                question={item.question}
                index={questionIndex}
                config={config}
                graded={test.graded}
                variant={variant}
                assets={assets}
              />
            )
          }
          if (item.kind === 'heading') {
            return (
              <View
                key={item.id}
                style={{
                  marginTop: config.sectionStyle.spacingBefore,
                  marginBottom: 4,
                  borderBottom: config.sectionStyle.rule ? '1pt solid #111' : undefined,
                  paddingBottom: 2,
                }}
                wrap={false}
              >
                <Text style={{ fontSize: config.sectionStyle.fontSize, fontWeight: 'bold' }}>
                  {config.sectionStyle.uppercase ? (item.text ?? '').toUpperCase() : item.text}
                </Text>
              </View>
            )
          }
          if (item.kind === 'instruction') {
            return (
              <Text key={item.id} style={{ marginTop: 8, fontStyle: 'italic', color: '#333' }}>
                {item.text}
              </Text>
            )
          }
          return <View key={item.id} break />
        })}

        {config.footer ? <Footer variant={variant} testTitle={test.title} /> : null}
      </Page>

      {withKey ? (
        <KeyPage
          test={test}
          config={config}
          items={ordered}
          variant={variant}
          totalPoints={total}
        />
      ) : null}
    </Document>
  )
}

function Header({
  test,
  config,
  totalPoints,
  variant,
}: {
  test: RenderableTest['test']
  config: TemplateConfig
  totalPoints: number
  variant: 'A' | 'B'
}) {
  const showScore = config.header.scoreBox && test.graded
  const values: Record<string, string> = {
    school: test.header.school,
    subject: test.header.subject,
    class: test.header.className,
    teacher: test.header.teacher,
    date: test.header.date,
    name: '',
    note: test.header.note,
  }

  return (
    <View style={{ marginBottom: 12 }} wrap={false}>
      {config.header.title.show ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
          <Text
            style={{
              flex: 1,
              fontSize: config.header.title.fontSize,
              fontWeight: 'bold',
              textAlign: config.header.title.align,
            }}
          >
            {config.header.title.uppercase ? test.title.toUpperCase() : test.title}
            {variant === 'B' ? '  (varianta B)' : ''}
          </Text>
          {showScore ? (
            <View style={{ width: 110, border: '1pt solid #111', padding: 4 }}>
              <Text style={{ fontSize: 8 }}>Body: ______ / {totalPoints}</Text>
              <Text style={{ fontSize: 8, marginTop: 4 }}>Známka: ______</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {test.description ? (
        <Text style={{ marginBottom: 6, fontStyle: 'italic', color: '#333' }}>{test.description}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {config.header.fields.map((field) => {
          const value = field.value || values[field.key] || ''
          return (
            <View
              key={field.key}
              style={{
                width: `${field.widthPercent}%`,
                flexDirection: 'row',
                alignItems: 'flex-end',
                marginBottom: 6,
                paddingRight: 10,
              }}
            >
              <Text>{field.label}:</Text>
              {value ? (
                <Text style={{ marginLeft: 4 }}>{value}</Text>
              ) : (
                <View style={{ flex: 1, borderBottom: LIGHT, marginLeft: 4, height: 12 }} />
              )}
            </View>
          )
        })}
      </View>

      {config.header.rule ? (
        <View style={{ borderBottom: '1pt solid #111', marginTop: 2 }} />
      ) : null}
    </View>
  )
}

function QuestionView({
  item,
  question,
  index,
  config,
  graded,
  variant,
  assets,
}: {
  item: ResolvedTestItem
  question: Question
  index: number
  config: TemplateConfig
  graded: boolean
  variant: 'A' | 'B'
  assets: Record<string, string>
}) {
  const style = resolveQuestionStyle(config, question.type)
  const label = questionLabel(index, config.numbering)
  const points = item.pointsOverride ?? question.points
  const showPoints = config.showPoints && graded
  const prompt = (question.payload as { prompt?: string }).prompt ?? ''

  return (
    <View
      style={{
        marginTop: style.spacingBefore,
        border: style.boxed ? LIGHT : undefined,
        padding: style.boxed ? 6 : 0,
      }}
      wrap={question.type === 'open'}
    >
      <View style={{ flexDirection: 'row' }}>
        {label ? <Text style={{ fontWeight: 'bold', marginRight: 5 }}>{label}</Text> : null}
        <Text style={{ flex: 1, fontWeight: 'bold' }}>{prompt}</Text>
        {showPoints ? (
          <Text style={{ fontSize: 8, color: '#555', marginLeft: 6 }}>
            ({formatPoints(points)} b.)
          </Text>
        ) : null}
      </View>
      <QuestionBody
        question={question}
        style={style}
        config={config}
        variant={variant}
        assets={assets}
      />
    </View>
  )
}

function KeyPage({
  test,
  config,
  items,
  variant,
  totalPoints,
}: {
  test: RenderableTest['test']
  config: TemplateConfig
  items: ResolvedTestItem[]
  variant: 'A' | 'B'
  totalPoints: number
}) {
  let index = -1
  return (
    <Page
      size="A4"
      style={{
        ...pagePadding(config),
        fontFamily: config.page.fontFamily,
        fontSize: config.page.fontSize,
        lineHeight: config.page.lineHeight,
        color: '#111',
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 2 }}>
        Klíč – {test.title} (varianta {variant})
      </Text>
      {test.graded ? (
        <Text style={{ fontSize: 9, color: '#555', marginBottom: 10 }}>
          Celkem {formatPoints(totalPoints)} bodů
        </Text>
      ) : (
        <View style={{ marginBottom: 10 }} />
      )}

      {items.map((item) => {
        if (item.kind === 'heading') {
          return (
            <Text key={item.id} style={{ marginTop: 10, fontWeight: 'bold' }}>
              {item.text}
            </Text>
          )
        }
        if (item.kind !== 'question' || !item.question) return null
        index += 1
        const question = item.question
        const points = item.pointsOverride ?? question.points
        return (
          <View key={item.id} style={{ marginTop: 6 }} wrap={false}>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>{questionLabel(index, config.numbering) || `${index + 1}.`} </Text>
              {formatAnswer(question, variant)}
              {test.graded ? (
                <Text style={{ color: '#555', fontSize: 8 }}> ({formatPoints(points)} b.)</Text>
              ) : null}
            </Text>
            {question.explanation ? (
              <Text style={{ fontSize: 8, color: '#555', marginLeft: 14 }}>{question.explanation}</Text>
            ) : null}
          </View>
        )
      })}
    </Page>
  )
}

function Footer({ variant, testTitle }: { variant: 'A' | 'B'; testTitle: string }) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 14,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 40,
      }}
    >
      <Text style={{ fontSize: 8, color: '#777' }}>
        {testTitle} · varianta {variant}
      </Text>
      <Text
        style={{ fontSize: 8, color: '#777' }}
        render={({ pageNumber, totalPages }) => `strana ${pageNumber} / ${totalPages}`}
      />
    </View>
  )
}

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}
