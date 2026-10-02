'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { SelectionBar } from '@/components/SelectionBar'
import { emptyHeader } from '@/components/test-builder/defaults'
import { newId } from '@/lib/ids'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

/** A question picked for a new test, with what the bar and the new test need. */
export interface CartQuestion {
  id: string
  points: number
  topicId: string
  topicName: string
  gradeId: string
  subjectName: string
}

interface CartState {
  /** In the order they were picked — the new test keeps it. */
  items: CartQuestion[]
  /** Template of the new test; the topic page knows the school's default. */
  templateId: string
}

interface CartApi {
  has: (id: string) => boolean
  toggle: (question: CartQuestion, templateId: string) => void
  /** Drops questions of a topic that no longer exist there (deleted, regenerated). */
  prune: (topicId: string, existingIds: Set<string>) => void
  /** Keeps points in step with edits made in the topic. */
  syncPoints: (points: Map<string, number>) => void
  clear: () => void
  items: CartQuestion[]
}

const CartContext = createContext<CartApi | null>(null)

const EMPTY: CartState = { items: [], templateId: '' }

interface CartStore {
  /** One cart per person and school (`QuestionCartProvider`'s `userId`). */
  carts: Record<string, CartState>
  update: (key: string, change: (current: CartState) => CartState) => void
}

/**
 * The selection lives in the browser of the signed-in person and survives
 * moving between topics and a reload (zustand `persist` over localStorage).
 * Storage may be unavailable (private window) — the cart then lasts until the
 * page is closed. Hydration is manual: the server and the first browser pass
 * render an empty cart, the stored one comes right after.
 */
const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      carts: {},
      update: (key, change) =>
        set((store) => {
          const current = store.carts[key] ?? EMPTY
          const next = change(current)
          return next === current ? store : { carts: { ...store.carts, [key]: next } }
        }),
    }),
    {
      name: 'testmaker:kosik',
      storage: createJSONStorage(() => localStorage),
      partialize: (store) => ({ carts: store.carts }),
      skipHydration: true,
    },
  ),
)

/**
 * Questions picked for a new test across topics. The teacher ticks questions
 * in one topic, goes to another and ticks more; the bar at the bottom shows
 * how many and how many points, and creates one test from all of them.
 */
export function QuestionCartProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const key = userId ?? 'local'
  useEffect(() => {
    void useCartStore.persist.rehydrate()
  }, [])
  const state = useCartStore((store) => store.carts[key] ?? EMPTY)
  const update = useCartStore((store) => store.update)

  const api = useMemo<CartApi>(() => {
    const ids = new Set(state.items.map((item) => item.id))
    const change = (fn: (current: CartState) => CartState) => update(key, fn)
    return {
      items: state.items,
      has: (id) => ids.has(id),
      toggle: (question, templateId) =>
        change((current) => ({
          templateId: templateId || current.templateId,
          items: current.items.some((item) => item.id === question.id)
            ? current.items.filter((item) => item.id !== question.id)
            : [...current.items, question],
        })),
      prune: (topicId, existingIds) =>
        change((current) => {
          const items = current.items.filter((item) => item.topicId !== topicId || existingIds.has(item.id))
          return items.length === current.items.length ? current : { ...current, items }
        }),
      syncPoints: (points) =>
        change((current) => {
          let changed = false
          const items = current.items.map((item) => {
            const next = points.get(item.id)
            if (next === undefined || next === item.points) return item
            changed = true
            return { ...item, points: next }
          })
          return changed ? { ...current, items } : current
        }),
      clear: () => change((current) => (current.items.length === 0 ? current : { ...current, items: [] })),
    }
  }, [key, state.items, update])

  return (
    <CartContext.Provider value={api}>
      {children}
      <CartBar templateId={state.templateId} />
    </CartContext.Provider>
  )
}

export function useQuestionCart(): CartApi {
  const cart = useContext(CartContext)
  if (!cart) throw new Error('useQuestionCart outside QuestionCartProvider')
  return cart
}

/** Pages where a bar for a new test would be in the way: building a test or worksheet. */
const NO_BAR = [/^\/tests\/./, /^\/listy\/./]

function CartBar({ templateId }: { templateId: string }) {
  const cart = useQuestionCart()
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)
  if (cart.items.length === 0 || NO_BAR.some((re) => re.test(pathname))) return null

  const points = cart.items.reduce((sum, item) => sum + item.points, 0)
  const topics = new Map(cart.items.map((item) => [item.topicId, item]))
  const single = topics.size === 1 ? cart.items[0]! : null
  const grades = new Set(cart.items.map((item) => item.gradeId))
  const subjects = new Set(cart.items.map((item) => item.subjectName))

  async function create() {
    setBusy(true)
    try {
      const result = await requestJson<{ id: string }>(
        '/api/tests',
        jsonBody('POST', {
          // One topic names the test; several give a neutral name to rename.
          title: single ? single.topicName : t('library:cart.mixedTitle', { count: topics.size }),
          templateId,
          header: { ...emptyHeader(), subject: subjects.size === 1 ? [...subjects][0] : '' },
          gradeId: grades.size === 1 ? [...grades][0] : null,
          items: cart.items.map((item) => ({
            id: newId(),
            kind: 'question',
            questionId: item.id,
            puzzleId: null,
            text: null,
            pointsOverride: null,
            linesOverride: null,
          })),
        }),
        t('library:topicQuestions.createTestFailed'),
      )
      if (!result.id) throw new Error(t('library:topicQuestions.createTestFailed'))
      cart.clear()
      // `refresh()` before `push()`: the page left behind would otherwise stay
      // in history without the „V testu“ badges.
      router.refresh()
      router.push(single ? `/tests/${result.id}?tema=${single.topicId}` : `/tests/${result.id}`)
    } catch (error) {
      toast.error(errorMessage(error, t('library:topicQuestions.createTestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-4">
      <div className="pointer-events-auto mx-auto max-w-3xl shadow-lg">
        <SelectionBar
          count={cart.items.length}
          points={points}
          topicCount={topics.size}
          busy={busy || !templateId}
          onCreate={() => void create()}
          onClear={cart.clear}
        />
      </div>
    </div>
  )
}
