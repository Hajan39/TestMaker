import { Circle, Document, Page, Path, Svg, Text, View } from '@react-pdf/renderer'
import { t } from '../i18n'
import type { Question } from '../schema/question'
import { puzzleInstructions, type PuzzleContent } from '../schema/puzzle'
import { resolveQuestionStyle, type TemplateConfig, type TemplateTheme } from '../schema/template'
import { itemQuestion, type RenderableTest, type ResolvedTestItem } from '../schema/test'
import { formatAnswer } from './answerKey'
import { puzzleHeadShown, puzzleKeepsTogether } from './estimate'
import { decorationColor, decorationShapes, formatPoints, PAGE_HEIGHT, PAGE_WIDTH, puzzleForVariant } from './layout'
import { QuestionBody } from './QuestionBody'
import { PuzzleBody } from './PuzzleBody'
import { TableBlock, TextBlock } from './WorksheetBlocks'
import { buildVariant } from './shuffle'
import { pagePadding, questionLabel } from './styles'
import { sanitizeText } from './text'

const LIGHT = '0.6pt solid #999'

/** One generic document driven by `template.config` — no template is hard-coded. */
export function TestDocument({ test, template, items, variant, withKey, filled = false, assets }: RenderableTest) {
  const config = template.config
  // A puzzle in variant B gets a different seed — grid and key then use the same one.
  const ordered = buildVariant(items, variant, test.id).map((item) =>
    item.kind === 'puzzle' && item.puzzle
      ? { ...item, puzzle: puzzleForVariant(item.puzzle, variant) }
      : item.kind === 'question' && item.question
        ? { ...item, question: itemQuestion(item.question, item) }
        : item,
  )
  const questions = ordered.filter((i) => i.kind === 'question' && i.question)
  const total = questions.reduce(
    (sum, i) => sum + (i.pointsOverride ?? i.question?.points ?? 0),
    0,
  )

  let questionIndex = -1
  // A standalone puzzle (see `loadRenderablePuzzle`) has no variant —
  // "variant A" in the key and footer would only confuse.
  const standalonePuzzle = ordered.length === 1 && ordered[0]?.kind === 'puzzle' && test.variants === 1
  // Worksheets are not split into variants in the app — "variant A" would only confuse.
  const variantLabel =
    (standalonePuzzle || (test.kind === 'pracovni_list' && test.variants === 1)) && variant === 'A' ? null : variant
  const firstContent = ordered.findIndex((item) => item.kind !== 'page_break')
  const heading = { title: test.title, description: test.description }

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
        <PageDecoration theme={config.theme} />
        {config.header.show ? (
          <Header test={test} config={config} totalPoints={total} variant={variant} />
        ) : null}

        {ordered.map((item, index) => {
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
                filled={filled}
              />
            )
          }
          if (item.kind === 'puzzle' && item.puzzle) {
            return (
              <PuzzleView
                key={item.id}
                puzzle={item.puzzle}
                config={config}
                solved={filled}
                // The puzzle does not repeat what the header already says (a
                // standalone puzzle has its title and instructions in the header).
                showTitle={puzzleHeadShown(item.puzzle, config, heading).title}
                showInstructions={puzzleHeadShown(item.puzzle, config, heading).instructions}
                // The first item right below the header stays together only by
                // rows — as a whole it could move to page two, leaving only the
                // header on page one.
                keepTogether={index !== firstContent && puzzleKeepsTogether(item, config, heading)}
              />
            )
          }
          if (item.kind === 'heading') {
            const { theme } = config
            const headingText = sanitizeText(
              config.sectionStyle.uppercase ? (item.text ?? '').toUpperCase() : (item.text ?? ''),
            )
            return theme.sectionBanner ? (
              // A playful worksheet: the heading is a band in the accent colour.
              <View
                key={item.id}
                style={{
                  marginTop: config.sectionStyle.spacingBefore,
                  marginBottom: 6,
                  backgroundColor: theme.accent,
                  borderRadius: theme.radius,
                  paddingVertical: 3,
                  paddingHorizontal: 8,
                }}
                wrap={false}
              >
                <Text style={{ fontSize: config.sectionStyle.fontSize, fontWeight: 'bold', color: '#ffffff' }}>
                  {headingText}
                </Text>
              </View>
            ) : (
              <View
                key={item.id}
                style={{
                  marginTop: config.sectionStyle.spacingBefore,
                  marginBottom: 4,
                  borderBottom: config.sectionStyle.rule ? `1pt solid ${theme.accent}` : undefined,
                  paddingBottom: 2,
                }}
                wrap={false}
              >
                <Text style={{ fontSize: config.sectionStyle.fontSize, fontWeight: 'bold', color: theme.accent }}>
                  {headingText}
                </Text>
              </View>
            )
          }
          if (item.kind === 'instruction') {
            return (
              <Text key={item.id} style={{ marginTop: 8, fontStyle: 'italic', color: '#333' }}>
                {sanitizeText(item.text ?? '')}
              </Text>
            )
          }
          if (item.kind === 'text') {
            // Broken content (unknown variant) must not take the whole worksheet
            // down — the text is at least printed as a plain paragraph.
            return (
              <TextBlock key={item.id} text={item.text ?? ''} variant={item.textContent?.variant ?? 'text'} config={config} />
            )
          }
          if (item.kind === 'table') {
            // A broken table is skipped; the editor shows it as invalid.
            return item.table ? (
              <TableBlock key={item.id} table={item.table} solved={filled} shade={config.theme.accentSoft} />
            ) : null
          }
          if (item.kind === 'page_break') return <View key={item.id} break />
          return null
        })}

        {config.footer ? <Footer variant={variantLabel} testTitle={test.title} /> : null}
      </Page>

      {withKey ? (
        <KeyPage
          test={test}
          config={config}
          items={ordered}
          variant={variant}
          variantLabel={variantLabel}
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
              color: config.theme.accent,
            }}
          >
            {sanitizeText(config.header.title.uppercase ? test.title.toUpperCase() : test.title)}
            {variant === 'B' ? `  ${t('pdf:header.variantB')}` : ''}
          </Text>
          {showScore ? (
            <View style={{ width: 110, border: '1pt solid #111', padding: 4 }}>
              <Text style={{ fontSize: 8 }}>{t('pdf:header.points', { total: totalPoints })}</Text>
              <Text style={{ fontSize: 8, marginTop: 4 }}>{t('pdf:header.grade')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {test.description ? (
        <Text style={{ marginBottom: 6, fontStyle: 'italic', color: '#333' }}>
          {sanitizeText(test.description)}
        </Text>
      ) : null}

      {/* Teacher and note are part of the test data model (`test.header`), but they are
          not fields the pupil fills in — so they are not printed via `config.header.fields`
          (those are fill-in lines) but as a fixed header line, only when filled in. */}
      {test.header.teacher ? (
        <Text style={{ marginBottom: 6 }}>{t('pdf:header.teacher', { name: sanitizeText(test.header.teacher) })}</Text>
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
              <Text>{sanitizeText(field.label)}:</Text>
              {value ? (
                <Text style={{ marginLeft: 4 }}>{sanitizeText(value)}</Text>
              ) : (
                <View style={{ flex: 1, borderBottom: LIGHT, marginLeft: 4, height: 12 }} />
              )}
            </View>
          )
        })}
      </View>

      {test.header.note ? (
        <Text style={{ marginBottom: 6, fontStyle: 'italic', color: '#333' }}>
          {t('pdf:header.note', { note: sanitizeText(test.header.note) })}
        </Text>
      ) : null}

      {config.header.rule ? (
        <View style={{ borderBottom: `1pt solid ${config.theme.accent}`, marginTop: 2 }} />
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
  filled,
}: {
  item: ResolvedTestItem
  question: Question
  index: number
  config: TemplateConfig
  graded: boolean
  variant: 'A' | 'B'
  assets: Record<string, string>
  filled: boolean
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
        border: style.boxed ? `0.8pt solid ${config.theme.border}` : undefined,
        borderRadius: style.boxed ? config.theme.radius : 0,
        padding: style.boxed ? 6 : 0,
      }}
      wrap={question.type === 'open'}
    >
      <View style={{ flexDirection: 'row' }}>
        {label && config.theme.numberBadge ? (
          // The number in a filled circle — the label without its punctuation.
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: config.theme.accent,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 6,
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 8.5, lineHeight: 1 }}>{String(index + 1)}</Text>
          </View>
        ) : label ? (
          <Text style={{ fontWeight: 'bold', marginRight: 5 }}>{label}</Text>
        ) : null}
        <Text style={{ flex: 1, fontWeight: 'bold' }}>{sanitizeText(prompt)}</Text>
        {showPoints ? (
          <Text style={{ fontSize: 8, color: '#555', marginLeft: 6 }}>
            {t('pdf:points', { points: formatPoints(points) })}
          </Text>
        ) : null}
      </View>
      <QuestionBody
        linesOverride={item.linesOverride}
        question={question}
        style={style}
        config={config}
        variant={variant}
        assets={assets}
        filled={filled}
      />
    </View>
  )
}

/**
 * A puzzle in a test. Title, instructions and grid (for a cryptogram the
 * phrase boxes) are always unbreakable — a grid split by a page break is
 * useless. When the puzzle fits a page by estimate (`keepTogether`), it stays
 * together as a whole and moves to the next page if needed. A taller puzzle
 * breaks by rows of the word list, crossword and clues; kept whole, react-pdf
 * would squash it onto one page.
 */
export function PuzzleView({
  puzzle,
  config,
  showTitle,
  showInstructions,
  keepTogether,
  solved = false,
}: {
  puzzle: PuzzleContent
  config: TemplateConfig
  showTitle: boolean
  showInstructions: boolean
  keepTogether: boolean
  /** The teacher's filled-in copy shows the puzzle solved in place. */
  solved?: boolean
}) {
  const body = (
    <PuzzleBody
      puzzle={puzzle}
      solved={solved}
      // When kept together as a whole, the wrapper carries the space above. Without
      // title and instructions (a standalone puzzle has them in the header) the
      // space below the header is enough.
      spacingBefore={keepTogether || (!showTitle && !showInstructions) ? 0 : config.sectionStyle.spacingBefore}
      head={
        <>
          {showTitle ? (
            <Text style={{ fontSize: config.sectionStyle.fontSize, fontWeight: 'bold' }}>
              {sanitizeText(puzzle.title)}
            </Text>
          ) : null}
          {showInstructions ? (
            <Text style={{ fontStyle: 'italic', color: '#333' }}>{sanitizeText(puzzleInstructions(puzzle))}</Text>
          ) : null}
        </>
      }
    />
  )
  // A breakable puzzle is returned as a flat list of blocks directly into the
  // page (see `PuzzleBody`) — no wrapping `View`.
  return keepTogether ? (
    <View style={{ marginTop: config.sectionStyle.spacingBefore }} wrap={false}>
      {body}
    </View>
  ) : (
    body
  )
}

function KeyPage({
  test,
  config,
  items,
  variant,
  variantLabel,
  totalPoints,
}: {
  test: RenderableTest['test']
  config: TemplateConfig
  items: ResolvedTestItem[]
  variant: 'A' | 'B'
  variantLabel: 'A' | 'B' | null
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
        {t('pdf:key.title', { title: sanitizeText(test.title) })}
        {variantLabel ? ` ${t('pdf:key.variant', { variant: variantLabel })}` : ''}
      </Text>
      {test.graded ? (
        <Text style={{ fontSize: 9, color: '#555', marginBottom: 10 }}>
          {t('pdf:key.totalPoints', { points: formatPoints(totalPoints) })}
        </Text>
      ) : (
        <View style={{ marginBottom: 10 }} />
      )}

      {items.map((item) => {
        if (item.kind === 'heading') {
          return (
            <Text key={item.id} style={{ marginTop: 10, fontWeight: 'bold' }}>
              {sanitizeText(item.text ?? '')}
            </Text>
          )
        }
        if (item.kind === 'puzzle' && item.puzzle) {
          return (
            // Only the title with the grid is unbreakable; the description of
            // where each word lies may break onto the next page for a large grid.
            <PuzzleBody
              key={item.id}
              puzzle={item.puzzle}
              solved
              spacingBefore={8}
              head={<Text style={{ fontWeight: 'bold' }}>{sanitizeText(t('pdf:key.solution', { title: item.puzzle.title }))}</Text>}
            />
          )
        }
        if (item.kind === 'table' && item.table) {
          return <TableBlock key={item.id} table={item.table} solved />
        }
        if (item.kind !== 'question' || !item.question) return null
        index += 1
        const question = item.question
        const points = item.pointsOverride ?? question.points
        return (
          <View key={item.id} style={{ marginTop: 6 }} wrap={false}>
            <Text>
              <Text style={{ fontWeight: 'bold' }}>{questionLabel(index, config.numbering) || `${index + 1}.`} </Text>
              {sanitizeText(formatAnswer(question, variant))}
              {test.graded ? (
                <Text style={{ color: '#555', fontSize: 8 }}> {t('pdf:points', { points: formatPoints(points) })}</Text>
              ) : null}
            </Text>
            {question.explanation ? (
              <Text style={{ fontSize: 8, color: '#555', marginLeft: 14 }}>
                {sanitizeText(question.explanation)}
              </Text>
            ) : null}
          </View>
        )
      })}
    </Page>
  )
}

function Footer({ variant, testTitle }: { variant: 'A' | 'B' | null; testTitle: string }) {
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
        // The line height inherited from the page gets multiplied by the font
        // size again on every page relayout for text with `render` (react-pdf
        // 4.9 converts already converted points as a multiplier). The page
        // number then grew to thousands of points and the footer slid off the
        // paper. An empty value means the natural height from font metrics,
        // which relayout does not change.
        lineHeight: '',
      }}
    >
      <Text style={{ fontSize: 8, color: '#777' }}>
        {sanitizeText(testTitle)}
        {variant ? ` · ${t('pdf:footer.variant', { variant })}` : ''}
      </Text>
      <Text
        style={{ fontSize: 8, color: '#777' }}
        // Counted within the test only — key pages after it are not added to the total.
        render={({ subPageNumber, subPageTotalPages }) =>
          t('pdf:footer.page', { page: subPageNumber, total: subPageTotalPages })
        }
      />
    </View>
  )
}

/** Shapes in the page margins of a playful template, repeated on every page. */
function PageDecoration({ theme }: { theme: TemplateTheme }) {
  const shapes = decorationShapes(theme.decoration)
  if (shapes.length === 0) return null
  return (
    <Svg
      fixed
      width={PAGE_WIDTH}
      height={PAGE_HEIGHT}
      viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      {shapes.map((shape, i) =>
        shape.kind === 'circle' ? (
          <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={decorationColor(theme, shape.tone)} />
        ) : (
          <Path key={i} d={shape.d} fill={decorationColor(theme, shape.tone)} />
        ),
      )}
    </Svg>
  )
}
