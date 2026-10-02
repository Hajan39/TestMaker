'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionStatus, QuestionType } from '@testmaker/core/schema'
import { QUESTION_TYPES, questionTypeLabel } from '@testmaker/core/schema'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@testmaker/ui'
import { QuestionEditorForm } from '@/components/QuestionEditor'
import { QuestionCard } from '@/components/QuestionCard'
import { useQuestionCart } from '@/components/QuestionCart'
import { useCanEdit } from '@/components/Permissions'
import { rejectQuestions, restoreStatuses } from '@/lib/questionStatusClient'
import { errorMessage } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

interface Filters {
  type: QuestionType | ''
  difficulty: 1 | 2 | 3 | ''
  /** „Jen nepoužité v testu" — hides questions that already appear in at least one visible test. */
  onlyUnused: boolean
}

export interface TestUsage {
  testId: string
  title: string
}

/** One version of a root question, as returned by `loadVariantLinks`. */
export interface VariantLink {
  id: string
  difficulty: 1 | 2 | 3
  status: QuestionStatus
}

export interface TopicQuestionsHandle {
  /**
   * Opens the „Nová otázka" form from outside — from the topic's empty state
   * (`EmptyState` in `TopicWorkspace`), where this card is not visible at first.
   */
  openCreate: () => void
}

/**
 * The topic's questions as cards: in-place editing, regeneration, deletion
 * with undo and adding one's own — no approval queue; it ends in the topic.
 *
 * The card being edited is tracked by the question's `id`, not by its
 * position in `questions` — that changes with every `router.refresh()`
 * (top-up generation, deleting another card), but an edit in progress stays open.
 */
export const TopicQuestions = forwardRef<
  TopicQuestionsHandle,
  {
    /** Topic metadata needed to create a test straight from the question selection. */
    topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }
    /** Default template for a new test (the same choice as for a test from scratch). */
    defaultTemplateId: string
    questions: Question[]
    /** Tests that already contain the question — only those visible to the caller. Missing key = none. */
    usage: Record<string, TestUsage[]>
    /**
     * Number of the topic's deleted (rejected) questions, loaded with the page.
     * The list of deleted cards is fetched separately, only once the toggle is on.
     */
    rejectedCount: number
    /**
     * Easier and harder versions by root (`loadVariantLinks`), for the
     * „Verze: …" row on the card. The key is the root question's id, not the question's own.
     */
    variantLinks: Record<string, VariantLink[]>
  }
>(function TopicQuestions({ topic, defaultTemplateId, questions, usage, rejectedCount, variantLinks }, ref) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const [creating, setCreating] = useState(false)
  useImperativeHandle(ref, () => ({
    openCreate: () => setCreating(true),
  }))
  const [editingId, setEditingId] = useState<string | null>(null)
  // A deleted (or regenerated) card disappears right away, without waiting for
  // the list to refresh from the server — this set is the only place that knows.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // Questions being deleted right now — guards against a double click before
  // the server answers (deletion is optimistic, the card vanishes even sooner).
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // Easier or harder versions created in this session — they appear right away,
  // without waiting for `router.refresh()` (which may show nothing new anyway
  // when an e2e test only fakes the server response). Questions that meanwhile
  // also appeared in `questions` (after a real page refresh) are dropped from
  // here so the card does not repeat.
  const [freshVersions, setFreshVersions] = useState<Question[]>([])
  // The card the „Verze: …" row just linked to, or that was just created as a
  // new version — briefly highlighted so it is clear the scroll worked.
  // Besides the id it carries a jump counter: a second jump to the same card
  // (e.g. right after the version was created, while it still glows) must
  // restart the countdown, otherwise the highlight would fade before the view
  // scrolls to it.
  const [highlight, setHighlight] = useState<{ id: string; jump: number } | null>(null)
  const highlightedId = highlight?.id ?? null
  // Id of the card to scroll to after rendering — two steps (set state, then
  // find the element in the DOM in an effect), because right after
  // `setFreshVersions` the new card is not in the DOM yet.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null)
  // Scrolling and highlighting are two separate effects on purpose: if the
  // scroll (setting `pendingScrollId`) and the highlight countdown were in the
  // same effect, its cleanup (run once `pendingScrollId` goes back to `null`)
  // would also clear the just-set highlight timer — the card would stay
  // highlighted forever because the reset would never be called.
  useEffect(() => {
    if (!pendingScrollId) return
    const el = document.querySelector(`[data-question-id="${pendingScrollId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlight((current) => ({ id: pendingScrollId, jump: (current?.jump ?? 0) + 1 }))
    setPendingScrollId(null)
  }, [pendingScrollId])
  useEffect(() => {
    if (!highlight) return
    const timeout = window.setTimeout(
      () => setHighlight((current) => (current === highlight ? null : current)),
      1500,
    )
    return () => window.clearTimeout(timeout)
  }, [highlight])
  const [filters, setFilters] = useState<Filters>({ type: '', difficulty: '', onlyUnused: false })
  // Questions checked for a new test live in the cart shared across topics
  // (`QuestionCart`) — the teacher may pick here, go to another topic and go on.
  const cart = useQuestionCart()
  // Deleted questions separately: `null` means "not loaded yet" — they are
  // only requested once the toggle is switched on, so they are not loaded
  // needlessly every time the teacher opens the topic.
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedQuestions, setDeletedQuestions] = useState<Question[] | null>(null)
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  // Cursor after the last loaded deleted question — `null` means "no next page"
  // (either nothing has loaded yet, or it is the end of the list;
  // `deletedQuestions === null` tells them apart).
  const [deletedCursor, setDeletedCursor] = useState<string | null>(null)
  const [loadingMoreDeleted, setLoadingMoreDeleted] = useState(false)
  // Questions being restored right now — guards against a double click on
  // „Obnovit", just like `busyIds` for deletion.
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  // How many were deleted (+) or restored (-) since the last server refresh
  // without showing in `rejectedCount` — it does not change until
  // `router.refresh()` reloads the page. Once that happens and
  // `rejectedCount` moves, the delta resets to zero.
  const [deletedDelta, setDeletedDelta] = useState(0)
  const previousRejectedCount = useRef(rejectedCount)
  useEffect(() => {
    if (rejectedCount !== previousRejectedCount.current) {
      previousRejectedCount.current = rejectedCount
      setDeletedDelta(0)
    }
  }, [rejectedCount])

  // Until the deleted list has loaded, the count comes from the server value
  // plus the local delta; once the list is fetched, it is counted from the
  // list directly — which shrinks by itself when a card is restored.
  const deletedCount = deletedQuestions?.length ?? rejectedCount + deletedDelta

  // Versions created in this session are added to the server's questions —
  // after a real page refresh they appear there too and are then dropped
  // from here by id so the card does not repeat.
  const allQuestions = useMemo(() => {
    const known = new Set(questions.map((question) => question.id))
    return [...freshVersions.filter((question) => !known.has(question.id)), ...questions]
  }, [questions, freshVersions])

  const sorted = useMemo(
    () =>
      allQuestions
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [allQuestions],
  )

  // Deleted (or regenerated) cards are subtracted from the topic entirely —
  // in the header and in the filter's type options; the filter itself does
  // not change the count.
  const active = useMemo(() => sorted.filter((question) => !hiddenIds.has(question.id)), [sorted, hiddenIds])

  // Root by id — lets a version's card find its root (`variantOf`) with its
  // difficulty, so the „Verze: …" row knows what is easier or harder than it.
  // `allQuestions`, not `active`: the root stays in play even if its own card
  // is currently hidden by an optimistic delete or regeneration.
  const byId = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [allQuestions])

  // `variantLinks` from the server (`loadVariantLinks`) plus the versions
  // created in this session — those may not be in the server response yet
  // (never in e2e tests, where the version-creation response is faked).
  const mergedVariantLinks = useMemo(() => {
    const merged: Record<string, VariantLink[]> = {}
    for (const [rootId, links] of Object.entries(variantLinks)) merged[rootId] = [...links]
    for (const question of freshVersions) {
      if (!question.variantOf) continue
      const list = merged[question.variantOf] ?? (merged[question.variantOf] = [])
      if (!list.some((link) => link.id === question.id)) {
        list.push({ id: question.id, difficulty: question.difficulty, status: question.status })
      }
    }
    return merged
  }, [variantLinks, freshVersions])

  /**
   * Versions of the question's root (or of the question itself if it is the
   * root), for the „Verze: …" row on the card. Rejected (deleted) versions are
   * not offered — their card is not in the list, the link would go nowhere.
   * Likewise anything outside `byId` is skipped (a question not in this topic
   * at all — another topic, or not loaded yet) and anything in `hiddenIds` (a
   * deleted or regenerated card that is disappearing from the list while the
   * server does not know yet) — in both cases the link would go nowhere.
   */
  function versionsFor(question: Question): { id: string; direction: 'easier' | 'harder' }[] {
    const rootId = question.variantOf ?? question.id
    const entries: { id: string; difficulty: 1 | 2 | 3 }[] = []
    if (rootId !== question.id && !hiddenIds.has(rootId)) {
      const root = byId.get(rootId)
      if (root) entries.push({ id: root.id, difficulty: root.difficulty })
    }
    for (const link of mergedVariantLinks[rootId] ?? []) {
      if (link.id === question.id || link.status === 'rejected' || hiddenIds.has(link.id)) continue
      const sibling = byId.get(link.id)
      if (!sibling) continue
      entries.push({ id: link.id, difficulty: sibling.difficulty })
    }
    return entries
      .filter((entry) => entry.difficulty !== question.difficulty)
      .map((entry) => ({ id: entry.id, direction: entry.difficulty < question.difficulty ? 'easier' : 'harder' }))
  }

  /**
   * Scrolls to a card and briefly highlights it — from the „Verze: …" row and
   * after creating a new version. When the filter (type, difficulty, „jen
   * nepoužité") currently hides the target, the filter is reset first —
   * otherwise there would be nothing to scroll to; the card would not be in the DOM.
   */
  function jumpToQuestion(id: string) {
    const isHiddenByFilter = !visible.some((question) => question.id === id) && active.some((question) => question.id === id)
    if (isHiddenByFilter) resetFilters()
    setPendingScrollId(id)
  }

  // The type filter only offers types actually present in the topic —
  // otherwise the teacher could pick „Doplňovačka“ and get nothing, even if
  // the topic never had one.
  const availableTypes = useMemo(() => {
    const present = new Set(active.map((question) => question.type))
    return [...QUESTION_TYPES].filter((type) => present.has(type))
  }, [active])

  const visible = active.filter((question) => {
    if (filters.type && question.type !== filters.type) return false
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false
    if (filters.onlyUnused && (usage[question.id]?.length ?? 0) > 0) return false
    return true
  })

  function resetFilters() {
    setFilters({ type: '', difficulty: '', onlyUnused: false })
  }

  // A deleted or regenerated card drops out of the cart by itself, and edited
  // points show in the bar right away.
  useEffect(() => {
    cart.prune(topic.id, new Set(active.map((question) => question.id)))
    cart.syncPoints(new Map(active.map((question) => [question.id, question.points])))
    // `cart` changes with every pick; only the topic's questions matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, topic.id])

  function toggleSelection(question: Question) {
    cart.toggle(
      {
        id: question.id,
        points: question.points,
        topicId: topic.id,
        topicName: topic.name,
        gradeId: topic.gradeId,
        subjectName: topic.subjectName,
      },
      defaultTemplateId,
    )
  }

  /** Deleting without asking — it can be undone right away, hence no confirmation dialog. */
  async function remove(question: Question) {
    if (busyIds.has(question.id)) return
    setBusyIds((current) => new Set(current).add(question.id))
    // Optimistic: the card disappears right away so deleting does not wait for
    // the server. If it fails, the card comes back and a toast reports the error.
    setHiddenIds((current) => new Set(current).add(question.id))
    try {
      const previous = await rejectQuestions([question])
      // The deleted card counts toward „Smazané" right away, not only after the
      // page refreshes from the server — and is added to an already loaded
      // deleted list, so it shows even if the panel is switched on now.
      setDeletedDelta((current) => current + 1)
      setDeletedQuestions((current) =>
        current === null ? null : [{ ...question, status: 'rejected' }, ...current],
      )
      toast.success(t('library:topicQuestions.deleted'), {
        duration: 10_000,
        action: {
          label: t('library:topicQuestions.undo'),
          onClick: () =>
            void restoreStatuses(previous)
              .then(() => {
                setHiddenIds((current) => {
                  const next = new Set(current)
                  next.delete(question.id)
                  return next
                })
                setDeletedDelta((current) => Math.max(0, current - 1))
                setDeletedQuestions((current) =>
                  current === null ? null : current.filter((q) => q.id !== question.id),
                )
                toast.success(t('library:topicQuestions.undone'))
                router.refresh()
              })
              .catch((error) =>
                toast.error(errorMessage(error, t('library:topicQuestions.undoFailed'))),
              ),
        },
      })
    } catch (error) {
      // Deletion failed — the card returns to the list.
      setHiddenIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
      toast.error(errorMessage(error, t('library:topicQuestions.deleteFailed')))
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
    }
  }

  /**
   * Fetches the topic's deleted (rejected) questions — only once, on first
   * toggle. Newest first (`order=desc`), so what the teacher deleted last is
   * on top; only one page is taken, more via „Načíst další" (`loadMoreDeleted`).
   */
  async function loadDeleted() {
    setLoadingDeleted(true)
    try {
      const response = await fetch(
        `/api/questions?topicId=${encodeURIComponent(topic.id)}&status=rejected&order=desc`,
      )
      if (!response.ok) throw new Error(t('library:topicQuestions.loadDeletedFailed'))
      const data = (await response.json()) as { items: Question[]; nextCursor: string | null }
      setDeletedQuestions(data.items)
      setDeletedCursor(data.nextCursor)
    } catch (error) {
      toast.error(errorMessage(error, t('library:topicQuestions.loadDeletedFailed')))
      setShowDeleted(false)
    } finally {
      setLoadingDeleted(false)
    }
  }

  /** Fetches the next page of deleted questions after the cursor from the previous load. */
  async function loadMoreDeleted() {
    if (!deletedCursor) return
    setLoadingMoreDeleted(true)
    try {
      const response = await fetch(
        `/api/questions?topicId=${encodeURIComponent(topic.id)}&status=rejected&order=desc&cursor=${encodeURIComponent(deletedCursor)}`,
      )
      if (!response.ok) throw new Error(t('library:topicQuestions.loadMoreDeletedFailed'))
      const data = (await response.json()) as { items: Question[]; nextCursor: string | null }
      setDeletedQuestions((current) => [...(current ?? []), ...data.items])
      setDeletedCursor(data.nextCursor)
    } catch (error) {
      toast.error(errorMessage(error, t('library:topicQuestions.loadMoreDeletedFailed')))
    } finally {
      setLoadingMoreDeleted(false)
    }
  }

  // The deleted panel sits below a long question list — without scrolling to
  // it, switching the toggle on in a long topic would show no visible change.
  const deletedPanelRef = useRef<HTMLDivElement>(null)

  function toggleShowDeleted() {
    setShowDeleted((current) => {
      const next = !current
      if (next && deletedQuestions === null) void loadDeleted()
      if (next) {
        requestAnimationFrame(() => deletedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }
      return next
    })
  }

  /** Restores a deleted question back to approved. */
  async function restore(question: Question) {
    if (restoringIds.has(question.id)) return
    setRestoringIds((current) => new Set(current).add(question.id))
    try {
      await restoreStatuses([[question.id, 'approved']])
      setDeletedQuestions((current) => (current ?? []).filter((q) => q.id !== question.id))
      setDeletedDelta((current) => Math.max(0, current - 1))
      // The question may also be hidden here (deleted during this page load) —
      // without removing it from `hiddenIds` it would stay hidden in the main
      // list after restoring, even though the server sends it as approved again.
      setHiddenIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
      toast.success(t('library:topicQuestions.restored'))
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('library:topicQuestions.restoreFailed')))
    } finally {
      setRestoringIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
    }
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">{t('library:topicQuestions.heading', { count: active.length })}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label htmlFor="topic-question-type-filter">{t('library:topicQuestions.type')}</Label>
            <Select
              value={filters.type || 'vse'}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  type: value === 'vse' ? '' : (value as QuestionType),
                }))
              }
            >
              <SelectTrigger id="topic-question-type-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">{t('library:topicQuestions.allTypes')}</SelectItem>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {questionTypeLabel(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label htmlFor="topic-question-difficulty-filter">{t('library:topicQuestions.difficulty')}</Label>
            <Select
              value={filters.difficulty ? String(filters.difficulty) : 'vse'}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  difficulty: value === 'vse' ? '' : (Number(value) as 1 | 2 | 3),
                }))
              }
            >
              <SelectTrigger id="topic-question-difficulty-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">{t('library:topicQuestions.allDifficulties')}</SelectItem>
                <SelectItem value="1">{t('library:questionEditor.difficultyEasy')}</SelectItem>
                <SelectItem value="2">{t('library:questionEditor.difficultyMedium')}</SelectItem>
                <SelectItem value="3">{t('library:questionEditor.difficultyHard')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-fg-soft">
            <Checkbox
              checked={filters.onlyUnused}
              onCheckedChange={(checked) =>
                setFilters((current) => ({ ...current, onlyUnused: checked === true }))
              }
            />
            {t('library:topicQuestions.onlyUnused')}
          </label>
          {canEdit ? (
            <Button
              size="sm"
              variant={showDeleted ? 'secondary' : 'outline'}
              aria-pressed={showDeleted}
              onClick={toggleShowDeleted}
            >
              {t('library:topicQuestions.deletedToggle', { count: deletedCount })}
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={creating}>
              {t('library:questionEditor.newTitle')}
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <div
          data-testid="new-question-form"
          className="mt-3 rounded-[var(--radius-outer)] border border-line p-3"
        >
          <QuestionEditorForm
            topicId={topic.id}
            question={null}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false)
              router.refresh()
            }}
          />
        </div>
      ) : null}

      {visible.length === 0 && !creating ? (
        <div className="mt-4">
          {active.length === 0 ? (
            <EmptyState
              title={t('library:topicQuestions.emptyTitle')}
              // A viewer (role `nahled`) does not write questions — that addition
              // would only offer an action she does not have.
              hint={canEdit ? t('library:topicQuestions.emptyHintEditor') : t('library:topicQuestions.emptyHintViewer')}
            />
          ) : (
            <EmptyState
              title={t('library:topicQuestions.noMatchTitle')}
              action={
                <Button variant="outline" onClick={resetFilters}>
                  {t('library:topicQuestions.resetFilter')}
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft">
          {visible.map((question) => (
            <li
              key={question.id}
              data-question-id={question.id}
              className={
                highlightedId === question.id
                  ? 'rounded-[var(--radius-inner)] bg-brand-bg py-3 transition-colors'
                  : 'py-3 transition-colors'
              }
            >
              <QuestionCard
                topicId={topic.id}
                question={question}
                editing={editingId === question.id}
                canEdit={canEdit}
                selected={cart.has(question.id)}
                busy={busyIds.has(question.id)}
                usage={usage[question.id]}
                versions={versionsFor(question)}
                onEditStart={() => setEditingId(question.id)}
                onEditCancel={() => setEditingId(null)}
                onEditSaved={() => {
                  setEditingId(null)
                  router.refresh()
                }}
                onToggleSelect={() => toggleSelection(question)}
                onRegenerateDone={() => setHiddenIds((current) => new Set(current).add(question.id))}
                onVariantCreated={(created) => {
                  setFreshVersions((current) => [created, ...current])
                  jumpToQuestion(created.id)
                }}
                onJumpToVersion={jumpToQuestion}
                onRemove={() => void remove(question)}
              />
            </li>
          ))}
        </ul>
      )}


      {showDeleted && canEdit ? (
        <div ref={deletedPanelRef} className="mt-4 border-t border-line-soft pt-3">
          <h3 className="text-sm font-semibold text-fg-soft">{t('library:topicQuestions.deletedHeading')}</h3>
          {loadingDeleted ? (
            <p className="mt-2 text-sm text-fg-muted">{t('common:status.loading')}</p>
          ) : (deletedQuestions?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">{t('library:topicQuestions.noDeleted')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {deletedQuestions!.map((question) => (
                <li key={question.id} data-question-id={question.id} className="py-3">
                  <QuestionCard
                    topicId={topic.id}
                    question={question}
                    editing={false}
                    canEdit={canEdit}
                    selected={false}
                    busy={false}
                    usage={undefined}
                    versions={[]}
                    onEditStart={() => {}}
                    onEditCancel={() => {}}
                    onEditSaved={() => {}}
                    onToggleSelect={() => {}}
                    onRegenerateDone={() => {}}
                    onVariantCreated={() => {}}
                    onJumpToVersion={() => {}}
                    onRemove={() => {}}
                    deleted
                    restoring={restoringIds.has(question.id)}
                    onRestore={() => void restore(question)}
                  />
                </li>
              ))}
            </ul>
          )}
          {deletedCursor ? (
            <div className="mt-3 flex justify-center">
              <Button
                size="sm"
                variant="outline"
                disabled={loadingMoreDeleted}
                onClick={() => void loadMoreDeleted()}
              >
                {loadingMoreDeleted ? t('common:status.loading') : t('library:topicQuestions.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
})
