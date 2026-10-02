import Link from 'next/link'
import { resources, t } from '@testmaker/core/i18n'
import { Badge, Button, Card, EmptyState } from '@testmaker/ui'
import { PERIOD_DAYS, type AiUsageOverview } from '@/lib/aiUsage'
import type { ModelQuota } from '@/lib/aiQuota'
import { formatShortDateTime, formatTime } from '@testmaker/core/dates'

const num = (value: number) => value.toLocaleString('cs-CZ')
const date = formatShortDateTime

function Table({ header, rows }: { header: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-fg-muted">
            {header.map((name, i) => (
              <th key={name} className={`py-2 pr-4 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((row) => (
            <tr key={String(row[0])}>
              {row.map((cell, i) => (
                <td key={i} className={`py-2 pr-4 ${i > 0 ? 'ui-numeric text-right' : 'text-fg'}`}>
                  {typeof cell === 'number' ? num(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const time = formatTime

/** One sentence on where the model stands today. */
function quotaState(quota: ModelQuota): string {
  if (quota.exhaustedAt) return t('admin:aiUsage.quota.exhausted', { time: time(quota.exhaustedAt) })
  if (quota.runsOutAt) return t('admin:aiUsage.quota.runsOut', { time: time(quota.runsOutAt) })
  if (quota.estimate === null) return quota.today === 0 ? t('admin:aiUsage.quota.idle') : t('admin:aiUsage.quota.noExperience')
  return quota.today === 0 ? t('admin:aiUsage.quota.idle') : t('admin:aiUsage.quota.fine')
}

/**
 * AI usage overview for the administrator: how the model ladder is set up and
 * what was actually called over the period. Read-only — configuration stays in
 * `AI_MODELS`. The period is switched by a link (`?dni=`), so the page stays
 * server-rendered and nothing is fetched from the browser.
 */
export function AiUsagePanel({ overview }: { overview: AiUsageOverview }) {
  const most = Math.max(1, ...overview.dayRows.map((day) => day.ok + day.limit + day.others))
  const column = (name: keyof typeof resources.cs.admin.aiUsage.columns) => t(`admin:aiUsage.columns.${name}`)

  return (
    <Card className="space-y-5 p-4" aria-labelledby="ai-usage">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-usage" className="font-medium text-fg">
          {t('admin:aiUsage.title')}
        </h2>
        <nav className="ml-auto flex gap-1" aria-label={t('admin:aiUsage.period')}>
          {PERIOD_DAYS.map((days) => (
            <Button key={days} asChild size="sm" variant={days === overview.days ? 'default' : 'outline'}>
              <Link href={`?dni=${days}`} aria-current={days === overview.days ? 'page' : undefined}>
                {t('admin:aiUsage.days', { days })}
              </Link>
            </Button>
          ))}
        </nav>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.ladder')}</h3>
        {overview.ladder.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('admin:aiUsage.noModels')}</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {overview.ladder.map((item, i) => (
              <li key={item.model} className="flex flex-wrap items-center gap-2">
                <span className="ui-numeric w-5 text-fg-muted">{i + 1}.</span>
                <span className={item.hasKey ? 'text-fg' : 'text-fg-muted line-through'}>{item.model}</span>
                {item.hasKey ? null : <Badge variant="secondary">{t('admin:aiUsage.missingKey')}</Badge>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.quota.title')}</h3>
        <p className="text-xs text-fg-muted">
          {t('admin:aiUsage.quota.hint', { resetAt: date(overview.quota.resetAt), nextResetAt: date(overview.quota.nextResetAt) })}
        </p>
        <Table
          header={[
            t('admin:aiUsage.quota.model'),
            t('admin:aiUsage.quota.today'),
            t('admin:aiUsage.quota.estimate'),
            t('admin:aiUsage.quota.remaining'),
            t('admin:aiUsage.quota.state'),
          ]}
          rows={overview.quota.models.map((quota) => [
            quota.model,
            quota.today,
            quota.estimate === null
              ? t('admin:aiUsage.quota.unknown')
              : `${t('admin:aiUsage.quota.estimateValue', { value: num(quota.estimate) })} (${t('admin:aiUsage.quota.basedOn', { count: quota.basedOnDays })})`,
            quota.remaining === null ? '—' : quota.remaining,
            quotaState(quota),
          ])}
        />
      </section>

      {overview.total === 0 ? (
        <EmptyState title={t('admin:aiUsage.emptyTitle')} hint={t('admin:aiUsage.emptyHint')} />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.byModel')}</h3>
            <Table
              header={[
                column('model'),
                column('calls'),
                column('ok'),
                column('limit'),
                column('badShape'),
                column('error'),
                column('input'),
                column('output'),
                column('lastAt'),
              ]}
              rows={overview.models.map((m) => [
                m.model,
                m.calls,
                m.ok,
                m.limit,
                m.badShape,
                m.error,
                m.input,
                m.output,
                date(m.lastAt),
              ])}
            />
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.byTask')}</h3>
              <Table
                header={[column('task'), column('calls'), column('input'), column('output')]}
                rows={overview.tasks.map((u) => [t(`admin:aiUsage.tasks.${u.task}`), u.calls, u.input, u.output])}
              />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.bySchool')}</h3>
              <Table
                header={[column('school'), column('calls'), column('input'), column('output')]}
                rows={overview.schools.map((s) => [s.name, s.calls, s.input, s.output])}
              />
            </section>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-fg-soft">{t('admin:aiUsage.byDay')}</h3>
            <div
              className="flex h-24 items-end gap-px"
              role="img"
              aria-label={t('admin:aiUsage.chartLabel', { days: overview.days })}
            >
              {overview.dayRows.map((day) => {
                const total = day.ok + day.limit + day.others
                return (
                  <div
                    key={day.day}
                    className="flex h-full min-w-0 flex-1 flex-col-reverse"
                    title={t('admin:aiUsage.dayTitle', {
                      day: day.day,
                      total,
                      ok: day.ok,
                      limit: day.limit,
                      others: day.others,
                    })}
                  >
                    <div className="bg-brand" style={{ height: `${(day.ok / most) * 100}%` }} />
                    <div className="bg-draft-fg" style={{ height: `${(day.limit / most) * 100}%` }} />
                    <div className="bg-fg-muted" style={{ height: `${(day.others / most) * 100}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-brand" /> {t('admin:aiUsage.legendOk')}
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-draft-fg" /> {t('admin:aiUsage.legendLimit')}
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-fg-muted" /> {t('admin:aiUsage.legendOthers')}
              </span>
            </div>
          </section>
        </>
      )}
    </Card>
  )
}
