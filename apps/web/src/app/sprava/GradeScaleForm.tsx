'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { t } from '@testmaker/core/i18n'
import { gradeBoundaries } from '@testmaker/core/compose'
import {
  DEFAULT_GRADE_SCALE,
  GRADE_SCALE_MAX_TOTAL,
  gradeScaleSchema,
  type GradeScale,
  type GradeScaleRow,
} from '@testmaker/core/schema'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  BusyButton,
  Button,
  Card,
  DataTable,
  Input,
  Label,
  toast,
  type ColumnDef,
} from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

const GRADE_INDEXES = [0, 1, 2, 3, 4] as const
const PERCENT_INDEXES = [0, 1, 2, 3] as const

const CELL_INPUT = 'ui-numeric h-8 w-14 px-1.5 text-right'

/**
 * The school's grade scale: percentages for any total plus a table of point
 * ranges for chosen totals. Validated by the same `gradeScaleSchema` as the API.
 */
export function GradeScaleForm({ initial, custom }: { initial: GradeScale; custom: boolean }) {
  const router = useRouter()
  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<GradeScale>({ resolver: zodResolver(gradeScaleSchema), defaultValues: initial })
  const { fields, insert, remove } = useFieldArray({ control, name: 'rows' })
  const [newTotal, setNewTotal] = useState('')
  const [newTotalError, setNewTotalError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  // `null` returns the school to the built-in scale.
  const saveMutation = useMutation({
    mutationFn: (scale: GradeScale | null) =>
      requestJson<{ scale: GradeScale; custom: boolean }>(
        '/api/sprava/hodnoceni',
        jsonBody('PUT', { scale }),
        t('admin:management.grades.saveFailed'),
      ),
    onSuccess: (data, scale) => {
      reset(data.scale ?? DEFAULT_GRADE_SCALE)
      toast.success(scale ? t('admin:management.grades.saved') : t('admin:management.grades.resetDone'), {
        testId: 'toast-grades-saved',
      })
      router.refresh()
    },
    onError: (error) => toast.error(errorMessage(error, t('admin:management.grades.saveFailed'))),
  })
  const saving = saveMutation.isPending && saveMutation.variables !== null
  const resetting = saveMutation.isPending && saveMutation.variables === null

  function addRow() {
    const total = Number(newTotal)
    if (!newTotal.trim() || !Number.isInteger(total) || total < 1 || total > GRADE_SCALE_MAX_TOTAL) {
      setNewTotalError(t('admin:management.grades.rowInvalid'))
      return
    }
    const rows = getValues('rows')
    if (rows.some((row) => row.total === total)) {
      setNewTotalError(t('admin:management.grades.rowExists', { total }))
      return
    }
    // Prefilled from the percentages, so the manager only corrects what differs.
    const percents = gradeScaleSchema.shape.percents.safeParse(getValues('percents')).data ?? DEFAULT_GRADE_SCALE.percents
    const ranges = gradeBoundaries(total, { percents, rows: [] })!.map(({ from, to }) => [from, to])
    const at = rows.findIndex((row) => row.total < total)
    insert(at === -1 ? rows.length : at, { total, ranges: ranges as GradeScaleRow['ranges'] })
    setNewTotal('')
    setNewTotalError(null)
  }

  const columns: ColumnDef<(typeof fields)[number]>[] = [
    {
      id: 'total',
      header: t('admin:management.grades.total'),
      meta: { numeric: true },
      cell: ({ row }) => <span className="font-medium text-fg">{row.original.total}</span>,
    },
    ...GRADE_INDEXES.map(
      (g): ColumnDef<(typeof fields)[number]> => ({
        id: `grade-${g + 1}`,
        header: t('admin:management.grades.grade', { grade: g + 1 }),
        cell: ({ row }) => {
          const { index, original } = row
          const cellErrors = errors.rows?.[index]?.ranges?.[g]
          return (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                inputMode="numeric"
                className={CELL_INPUT}
                aria-label={t('admin:management.grades.cellFrom', { count: original.total, grade: g + 1 })}
                aria-invalid={cellErrors?.[0] ? true : undefined}
                defaultValue={original.ranges[g][0]}
                {...register(`rows.${index}.ranges.${g}.0`, { valueAsNumber: true })}
              />
              <span aria-hidden className="text-fg-muted">
                –
              </span>
              <Input
                type="number"
                inputMode="numeric"
                className={CELL_INPUT}
                aria-label={t('admin:management.grades.cellTo', { count: original.total, grade: g + 1 })}
                aria-invalid={cellErrors?.[1] ? true : undefined}
                defaultValue={original.ranges[g][1]}
                {...register(`rows.${index}.ranges.${g}.1`, { valueAsNumber: true })}
              />
            </div>
          )
        },
      }),
    ),
    {
      id: 'remove',
      header: () => <span className="sr-only">{t('admin:management.grades.remove')}</span>,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('admin:management.grades.removeRow', { count: row.original.total })}
          onClick={() => remove(row.index)}
        >
          <X />
        </Button>
      ),
    },
  ]

  // Messages per row under the table — a cell is too narrow for a sentence.
  const rowMessages = fields.flatMap((field, i) => {
    const rowErrors = errors.rows?.[i]
    if (!rowErrors) return []
    const messages = [
      rowErrors.total?.message,
      ...GRADE_INDEXES.flatMap((g) => [rowErrors.ranges?.[g]?.[0]?.message, rowErrors.ranges?.[g]?.[1]?.message]),
    ].filter((message): message is string => Boolean(message))
    return [...new Set(messages)].map((message) =>
      t('admin:management.grades.rowError', { count: field.total, message }),
    )
  })

  return (
    <>
      <form className="space-y-4" onSubmit={handleSubmit((scale) => saveMutation.mutate(scale))} noValidate>
        <div className="space-y-1">
          <p className="max-w-3xl text-sm text-fg-soft">{t('admin:management.grades.intro')}</p>
          <p className="text-sm text-fg" data-testid="grade-scale-status" data-custom={custom}>
            {custom ? t('admin:management.grades.custom') : t('admin:management.grades.builtIn')}
          </p>
        </div>

        <Card className="space-y-3">
          <h2 className="font-medium text-fg">{t('admin:management.grades.percentsHeading')}</h2>
          <div className="flex flex-wrap gap-3">
            {PERCENT_INDEXES.map((i) => (
              <div key={i} className="w-36">
                <Label htmlFor={`grade-percent-${i}`}>{t('admin:management.grades.percentFor', { grade: i + 1 })}</Label>
                <Input
                  id={`grade-percent-${i}`}
                  type="number"
                  inputMode="decimal"
                  className="ui-numeric"
                  aria-invalid={errors.percents?.[i] ? true : undefined}
                  defaultValue={initial.percents[i]}
                  {...register(`percents.${i}`, { valueAsNumber: true })}
                />
                {errors.percents?.[i]?.message ? (
                  <p className="mt-1 text-xs text-danger" role="alert">
                    {errors.percents[i].message}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-w-0 space-y-3">
          <h2 className="font-medium text-fg">{t('admin:management.grades.tableHeading')}</h2>
          {/* `DataTable` scrolls sideways inside its own box on a phone, not the page. */}
          <DataTable columns={columns} data={fields} getRowId={(row) => row.id} />
          {rowMessages.length > 0 ? (
            <ul className="space-y-0.5 text-sm text-danger" role="alert" data-testid="grade-scale-errors">
              {rowMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Label htmlFor="grade-new-total">{t('admin:management.grades.newTotal')}</Label>
              <Input
                id="grade-new-total"
                type="number"
                inputMode="numeric"
                className="ui-numeric"
                value={newTotal}
                aria-invalid={newTotalError ? true : undefined}
                onChange={(event) => setNewTotal(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the row instead of saving the whole form.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addRow()
                  }
                }}
              />
            </div>
            <Button type="button" variant="outline" onClick={addRow}>
              {t('admin:management.grades.addRow')}
            </Button>
            {newTotalError ? (
              <p className="w-full text-sm text-danger" role="alert" data-testid="grade-new-total-error">
                {newTotalError}
              </p>
            ) : null}
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <BusyButton type="submit" busy={saving} busyLabel={t('actions.saving')} disabled={resetting}>
            {t('actions.save')}
          </BusyButton>
          <BusyButton
            type="button"
            variant="outline"
            busy={resetting}
            busyLabel={t('admin:management.grades.resetting')}
            disabled={saving}
            onClick={() => setConfirmReset(true)}
          >
            {t('admin:management.grades.reset')}
          </BusyButton>
        </div>
      </form>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin:management.grades.resetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('admin:management.grades.resetDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => saveMutation.mutate(null)}>
              {t('admin:management.grades.resetConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
