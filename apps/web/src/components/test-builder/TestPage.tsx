'use client'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { paginate } from '@testmaker/core/pdf/estimate'
import { formatAnswer, questionLabel } from '@testmaker/core/pdf/layout'
import { resolveQuestionStyle, type ResolvedTestItem, type Template, type TestHeaderConfig } from '@testmaker/core/schema'
import { Fragment, useId, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  PaperHeader,
  PaperPuzzle,
  PaperQuestion,
  PaperSheet,
} from '@testmaker/ui'
import { formatPoints, type DraftItem } from './types'

/**
 * Stránka písemky — náhled a obsah testu v jedné ploše.
 *
 * Dřív to bylo dvojí: v jednom sloupci se skládala osnova (seznam řádků)
 * a ve druhém se ukazoval hrubý náhled, ze kterého si učitelka musela
 * domýšlet, jak to dopadne na papíře. Tady se skládá rovnou na listech,
 * které vypadají jako výsledný tisk: otázky se vykreslují komponentou
 * `PaperQuestion` z `packages/ui` (tatáž předloha jako PDF) a stránky se
 * lámou funkcí `paginate`, tedy tam, kde se zlomí ve skutečném PDF.
 *
 * Papír ukazuje jen to, co dostanou žáci — klíč se do něj nekreslí nikdy.
 * Vzorovou odpověď si jde u jednotlivé otázky vyžádat tlačítkem „Řešení“
 * v ovládání u okraje; ukáže se mimo papír, s poznámkou, že se netiskne.
 */
export function TestPage({
  items,
  title,
  description,
  header,
  graded,
  template,
  onReorder,
  onRemove,
  onPatch,
  onAdd,
}: {
  items: DraftItem[]
  title: string
  description: string
  header: TestHeaderConfig
  graded: boolean
  /** Bez šablony se neví, jak se stránka tiskne — plocha zůstane prázdná. */
  template: Template | null
  onReorder: (from: number, to: number) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
  /** `index` je místo, kam položka přijde (0 = úplně nahoru); bez něj na konec. */
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
}) {
  // Které otázky mají zrovna odkryté řešení. Stav patří sem, ne do položky:
  // s testem se neukládá a po zavření okna nikomu nechybí.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  const questionCount = items.filter((item) => item.kind === 'question').length
  const totalPoints = items.reduce(
    (sum, item) => (item.kind === 'question' ? sum + (item.pointsOverride ?? item.question?.points ?? 0) : sum),
    0,
  )

  /** Položky v tom tvaru, ve kterém je čte vykreslení PDF i stránkování. */
  const resolved = useMemo<ResolvedTestItem[]>(
    () =>
      items.map((item, index) => ({
        id: item.key,
        testId: 'draft',
        order: index,
        kind: item.kind,
        questionId: item.questionId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
        question: item.question,
        // Bez obsahu hlavolamu by mu odhad přidělil nulovou výšku a náhled by
        // měl méně stran než PDF.
        puzzleId: item.puzzleId,
        puzzle: item.puzzle,
      })),
    [items],
  )

  /**
   * Rozdělení na stránky. `paginate` zalomení strany do stránek nevrací
   * (jen jimi láme), proto se položky rozdělují podle něj, ale prochází se
   * původní pořadí — jinak by zalomení ze stránky zmizelo a nešlo by ho
   * odebrat ani přesunout.
   */
  const pages = useMemo(() => {
    // Nadpis a popis patří do hlavičky na první straně; odhad podle nich
    // pozná i hlavolam, který svůj nadpis neopakuje.
    const broken = template ? paginate(resolved, template.config, { title, description }) : [resolved]
    const pageOfKey = new Map<string, number>()
    broken.forEach((page, index) => page.forEach((item) => pageOfKey.set(item.id, index)))

    const groups: { item: DraftItem; index: number; number: number | null }[][] = broken.map(() => [])
    let current = 0
    let questionNumber = -1
    items.forEach((item, index) => {
      // Zalomení patří na konec stránky, kterou ukončuje.
      const page = item.kind === 'page_break' ? current : (pageOfKey.get(item.key) ?? current)
      current = page
      if (item.kind === 'question') questionNumber += 1
      groups[page]?.push({ item, index, number: item.kind === 'question' ? questionNumber : null })
    })
    return groups
  }, [items, resolved, template, title, description])

  /**
   * Táž otázka smí být v testu víckrát. Aby se poznalo, který výskyt je
   * který, dostanou opakované otázky pořadí použití.
   */
  const repeats = useMemo(() => {
    const total = new Map<string, number>()
    for (const item of items) {
      if (item.questionId) total.set(item.questionId, (total.get(item.questionId) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const item of items) {
      if (!item.questionId || (total.get(item.questionId) ?? 0) < 2) continue
      const order = (seen.get(item.questionId) ?? 0) + 1
      seen.set(item.questionId, order)
      labels.set(item.key, `${order}. použití`)
    }
    return labels
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // dnd-kit si bez `id` čísluje `aria-describedby` počítadlem, které na serveru
  // a v prohlížeči běží jinak — stránka pak hlásí nesoulad při hydrataci.
  const dndId = useId()

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((item) => item.key === active.id)
    const to = items.findIndex((item) => item.key === over.id)
    if (from === -1 || to === -1) return
    onReorder(from, to)
  }

  function toggleAnswer(key: string) {
    setRevealed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  return (
    <Card className="surface-content flex h-full flex-col gap-0 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Stránka</h2>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => onAdd('heading')}>
            + Nadpis části
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('instruction')}>
            + Pokyn
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd('page_break')}>
            + Nová strana
          </Button>
        </div>
      </div>

      {template ? (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-outer)] bg-surface-muted p-3">
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {pages.map((page, pageIndex) => (
                  <PaperSheet
                    key={pageIndex}
                    config={template.config}
                    footerLeft={title || 'Nový test'}
                    footerRight={`strana ${pageIndex + 1} / ${pages.length}`}
                  >
                    {pageIndex === 0 ? (
                      <PaperHeader
                        title={title}
                        description={description}
                        header={header}
                        config={template.config}
                        graded={graded}
                        totalPoints={totalPoints}
                      />
                    ) : null}
                    {pageIndex === 0 && items.length === 0 ? (
                      <p className="mt-6 text-center text-sm text-paper-fg opacity-60">
                        Zatím prázdná písemka. Zaškrtni otázku v bance a objeví se tady na stránce.
                      </p>
                    ) : null}
                    <ol>
                      {page.map(({ item, index, number }) => (
                        <Fragment key={item.key}>
                          <InsertSlot index={index} total={items.length} onAdd={onAdd} />
                          <PageRow
                            item={item}
                            number={number}
                            graded={graded}
                            template={template}
                            repeatLabel={repeats.get(item.key) ?? null}
                            revealed={revealed.has(item.key)}
                            onToggleAnswer={toggleAnswer}
                            onRemove={onRemove}
                            onPatch={onPatch}
                          />
                        </Fragment>
                      ))}
                      {pageIndex === pages.length - 1 ? (
                        <InsertSlot index={items.length} total={items.length} onAdd={onAdd} />
                      ) : null}
                    </ol>
                  </PaperSheet>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          Bez šablony se neví, jak se písemka vytiskne. Vyber ji v nastavení testu.
        </p>
      )}

      {items.length > 0 ? (
        <dl className="mt-3 flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-sm text-fg-muted">
          <div>
            <dt className="inline text-fg-soft">Otázek: </dt>
            <dd className="ui-numeric inline">{questionCount}</dd>
          </div>
          {graded ? (
            <div>
              <dt className="inline text-fg-soft">Body: </dt>
              <dd className="ui-numeric inline">{formatPoints(totalPoints)}</dd>
            </div>
          ) : null}
          {template ? (
            <div>
              <dt className="inline text-fg-soft">Odhad stran: </dt>
              <dd className="ui-numeric inline">{pages.length}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Card>
  )
}

/**
 * Místo mezi položkami, kam jde vložit nadpis, pokyn nebo zalomení strany.
 * Je to obyčejné tlačítko s nabídkou, takže na něj dosáhne i klávesnice —
 * přetahování myší (dnd-kit) tím zůstává nedotčené.
 */
function InsertSlot({
  index,
  total,
  onAdd,
}: {
  index: number
  total: number
  onAdd: (kind: 'heading' | 'instruction' | 'page_break', index?: number) => void
}) {
  const label = index === total ? 'Vložit na konec' : `Vložit před ${index + 1}. položku`
  return (
    <li className="group/slot flex list-none items-center gap-2 py-0.5">
      <span aria-hidden="true" className="h-px flex-1 bg-paper-line opacity-0 transition-opacity group-hover/slot:opacity-100" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-2 text-xs text-fg-muted opacity-35 transition-opacity hover:bg-surface hover:opacity-100 focus-visible:opacity-100 group-hover/slot:opacity-100"
            aria-label={label}
            title={`${label}: nadpis části, pokyn, nebo zalomení strany`}
          >
            +
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => onAdd('heading', index)}>Nadpis části</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('instruction', index)}>Pokyn</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('page_break', index)}>Zalomení strany</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden="true" className="h-px flex-1 bg-paper-line opacity-0 transition-opacity group-hover/slot:opacity-100" />
    </li>
  )
}

/**
 * Jedna položka na stránce. Vykresluje se jako tisk; ovládání (úchyt,
 * body, řádky, řešení, odebrání) se vynoří u okraje, až když je položka pod
 * myší nebo v ní stojí ohnisko — jinak by stránka vypadala jako formulář.
 * Průhledné ovládání zůstává v pořadí tabulátoru, takže je dosažitelné
 * i z klávesnice.
 */
function PageRow({
  item,
  number,
  graded,
  template,
  repeatLabel,
  revealed,
  onToggleAnswer,
  onRemove,
  onPatch,
}: {
  item: DraftItem
  /** Pořadí otázky v testu (od nuly); u ostatních položek `null`. */
  number: number | null
  graded: boolean
  template: Template
  repeatLabel: string | null
  revealed: boolean
  onToggleAnswer: (key: string) => void
  onRemove: (key: string) => void
  onPatch: (key: string, patch: Partial<DraftItem>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  const config = template.config
  const question = item.question
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const pt = (value: number) => `calc(${value} * var(--paper-pt, 1.3333px))`

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group/row relative list-none rounded-[var(--radius-inner)] outline-offset-4 hover:outline hover:outline-line focus-within:outline focus-within:outline-line"
    >
      {/* Ovládání u okraje listu. Zůstává v toku klávesnice i když ho není vidět. */}
      <div className="absolute -top-3 right-0 z-10 flex items-center gap-1 rounded-[var(--radius-inner)] border border-line bg-surface px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className="cursor-grab touch-none px-1 text-fg-muted active:cursor-grabbing"
          aria-label="Přetáhnout pro změnu pořadí"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        {item.kind === 'question' && graded ? (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            b.
            <Input
              className="h-6 w-14 px-1 text-xs"
              type="number"
              min={0}
              step={0.5}
              aria-label="Body za otázku"
              value={item.pointsOverride ?? question?.points ?? 0}
              onChange={(event) => onPatch(item.key, { pointsOverride: Number(event.target.value) || 0 })}
            />
          </label>
        ) : null}
        {/* Kolik místa žák potřebuje, záleží na písemce, ne na otázce —
            proto se počet linek nastavuje tady, ne u otázky v bance. */}
        {item.kind === 'question' && (question?.type === 'open' || question?.type === 'draw') ? (
          <label className="flex items-center gap-1 text-xs text-fg-muted">
            řádků
            <Input
              className="h-6 w-14 px-1 text-xs"
              type="number"
              min={1}
              max={30}
              step={1}
              aria-label="Řádků na odpověď"
              value={item.linesOverride ?? (question.payload as { lines?: number }).lines ?? (question.type === 'draw' ? 8 : 4)}
              onChange={(event) => onPatch(item.key, { linesOverride: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
        ) : null}
        {item.kind === 'question' && question ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            aria-pressed={revealed}
            onClick={() => onToggleAnswer(item.key)}
          >
            Řešení
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onRemove(item.key)}>
          Odebrat
        </Button>
      </div>

      {repeatLabel || item.questionMissing || item.questionEdited ? (
        <div className="flex flex-wrap items-center gap-1 pt-2">
          {repeatLabel ? <Badge variant="secondary">{repeatLabel}</Badge> : null}
          {/* Test drží obsah otázky zmrazený k okamžiku zařazení, aby se
              vytištěná písemka nemohla pozdější úpravou otázky změnit.
              Když se banka mezitím rozešla, je to vidět tady. */}
          {item.questionMissing ? (
            <Badge className="bg-draft-bg text-draft-fg">otázka už v bance není</Badge>
          ) : item.questionEdited ? (
            <Badge className="bg-draft-bg text-draft-fg">otázka byla od zařazení upravena</Badge>
          ) : null}
        </div>
      ) : null}

      {item.kind === 'question' && question ? (
        <>
          <PaperQuestion
            question={question}
            label={number === null ? undefined : questionLabel(number, config.numbering)}
            points={config.showPoints && graded ? (item.pointsOverride ?? question.points) : null}
            lines={item.linesOverride}
            style={resolveQuestionStyle(config, question.type)}
          />
          {revealed ? (
            // Mimo papír, jinou barvou: je to poznámka pro učitelku, ne pro žáky.
            <p
              data-slot="reseni"
              className="mt-1 rounded-[var(--radius-inner)] bg-brand-bg px-2 py-1 text-xs text-fg-soft"
            >
              <span className="font-medium">Vzorová odpověď (netiskne se): </span>
              {formatAnswer(question, 'A')}
              {question.explanation ? <span className="text-fg-muted"> — {question.explanation}</span> : null}
            </p>
          ) : null}
        </>
      ) : item.kind === 'puzzle' && item.puzzle ? (
        // Hlavolam se v osnově jen ukazuje tak, jak se vytiskne; slova
        // a mřížka se mění na obrazovce Hlavolamy, ne tady.
        <PaperPuzzle puzzle={item.puzzle} className="text-paper-fg" />
      ) : item.kind === 'page_break' ? (
        <p className="my-2 flex items-center gap-2 text-xs text-fg-muted">
          <span aria-hidden="true" className="h-px flex-1 border-b border-dashed border-line" />
          nová strana
          <span aria-hidden="true" className="h-px flex-1 border-b border-dashed border-line" />
        </p>
      ) : item.kind === 'heading' ? (
        <div
          className="text-paper-fg"
          style={{
            marginTop: pt(config.sectionStyle.spacingBefore),
            marginBottom: pt(4),
            paddingBottom: pt(2),
            borderBottom: config.sectionStyle.rule ? '1px solid var(--color-paper-fg)' : undefined,
          }}
        >
          <input
            className="w-full bg-transparent font-bold outline-none placeholder:opacity-40"
            style={{
              fontSize: pt(config.sectionStyle.fontSize),
              textTransform: config.sectionStyle.uppercase ? 'uppercase' : undefined,
            }}
            aria-label="Nadpis části"
            placeholder="Nadpis části"
            value={item.text ?? ''}
            onChange={(event) => onPatch(item.key, { text: event.target.value })}
          />
        </div>
      ) : (
        <input
          className="w-full bg-transparent italic text-paper-fg opacity-90 outline-none placeholder:opacity-40"
          style={{ marginTop: pt(8) }}
          aria-label="Pokyn k vypracování"
          placeholder="Pokyn k vypracování"
          value={item.text ?? ''}
          onChange={(event) => onPatch(item.key, { text: event.target.value })}
        />
      )}
    </li>
  )
}
