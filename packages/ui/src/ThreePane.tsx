'use client'

import type { ReactNode } from 'react'
import { t } from '@testmaker/core/i18n'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { useMatchesMedia } from './useMatchesMedia'

/**
 * Three columns per the spec. Below 1280 px the second column drops out,
 * below 1024 px a single column remains and tabs switch between columns.
 *
 * Content is rendered only once. An earlier version had both variants on the
 * page at once and hid one, which duplicated `id`s and field labels pointed at
 * the invisible copy.
 */
export function ThreePane({
  first,
  second,
  firstLabel = t('ui:threePane.first'),
  secondLabel = t('ui:threePane.second'),
  contentLabel = t('ui:threePane.content'),
  children,
}: {
  first: ReactNode
  second: ReactNode
  firstLabel?: string
  secondLabel?: string
  contentLabel?: string
  children: ReactNode
}) {
  const narrow = useMatchesMedia('(max-width: 1023.98px)')

  if (narrow) {
    return (
      <div className="surface-chrome h-full min-h-0">
        <Tabs defaultValue="content" className="flex h-full min-h-0 flex-col gap-0">
          <TabsList className="shrink-0">
            <TabsTrigger value="first">{firstLabel}</TabsTrigger>
            <TabsTrigger value="second">{secondLabel}</TabsTrigger>
            <TabsTrigger value="content">{contentLabel}</TabsTrigger>
          </TabsList>
          <TabsContent value="first" className="min-h-0 flex-1 overflow-y-auto bg-surface-muted p-3">
            {first}
          </TabsContent>
          <TabsContent value="second" className="min-h-0 flex-1 overflow-y-auto p-3">
            {second}
          </TabsContent>
          <TabsContent value="content" className="surface-content min-h-0 flex-1 overflow-y-auto p-5">
            {children}
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label={firstLabel}
        className="surface-chrome w-60 shrink-0 overflow-y-auto border-r border-line bg-surface-muted p-3"
      >
        {first}
      </aside>
      <aside
        aria-label={secondLabel}
        className="surface-chrome hidden w-70 shrink-0 overflow-y-auto border-r border-line p-3 xl:block"
      >
        {second}
      </aside>
      <section aria-label={contentLabel} className="surface-content min-w-0 flex-1 overflow-y-auto p-5">
        {children}
      </section>
    </div>
  )
}
