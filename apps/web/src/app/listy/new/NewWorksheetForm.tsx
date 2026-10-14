'use client'

import { useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@testmaker/ui'
import { emptyHeader } from '@/components/test-builder/defaults'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'
import { KindMark } from '@/components/KindMark'

/** The "Bez ročníku" (no grade) option — Select cannot use an empty value as an item. */
const NO_GRADE = 'bez-rocniku'

export interface WorksheetSubject {
  id: string
  name: string
  grades: { id: string; name: string; topics: { id: string; name: string }[] }[]
}

/** The form's shape, by source; built on each render so the messages follow the current language. */
function worksheetSchema() {
  const brief = {
    subjectId: z.string(),
    gradeId: z.string(),
    freeGradeId: z.string(),
    instructions: z.string().trim(),
    ownText: z.string().trim(),
    onlyMaterials: z.boolean(),
  }
  return z.discriminatedUnion('source', [
    z.object({
      source: z.literal('topic'),
      topicId: z.string().min(1, t('worksheets:new.missingTopic')),
      title: z.string(),
      ...brief,
    }),
    z.object({
      source: z.literal('free'),
      topicId: z.string(),
      title: z.string().trim().min(1, t('worksheets:new.missingTitle')),
      ...brief,
    }),
  ])
}
type WorksheetValues = z.output<ReturnType<typeof worksheetSchema>>

/**
 * The "Nový pracovní list" form. A worksheet is made from a library topic or
 * from a free-form brief (title and grade); both accept an instruction and
 * pasted own text. Without a configured model generation is not offered and
 * only an empty worksheet to fill in by hand remains.
 */
export function NewWorksheetForm({
  subjects,
  templateId,
  ai,
  limits,
}: {
  subjects: WorksheetSubject[]
  /** Template of an empty worksheet — the first in order, as for a new test. */
  templateId: string
  ai: { configured: boolean; problems: string[] }
  /** Limits of the instruction and own text from `AI_SETTINGS.worksheet` — the server enforces them too. */
  limits: { instructionsMax: number; ownTextMax: number }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'generate' | 'blank' | null>(null)
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<z.input<ReturnType<typeof worksheetSchema>>, unknown, WorksheetValues>({
    resolver: zodResolver(worksheetSchema()),
    defaultValues: {
      source: subjects.length > 0 ? 'topic' : 'free',
      subjectId: '',
      gradeId: '',
      topicId: '',
      title: '',
      freeGradeId: '',
      instructions: '',
      ownText: '',
      onlyMaterials: true,
    },
  })
  // Did the teacher move elsewhere in the app before the worksheet finished? Then don't pull her back.
  // Also set on mount: in development React runs the effect, cleans up and runs it again.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The server finishes the worksheet even after the page closes, but the teacher
  // would not learn the outcome — so leaving during generation asks first.
  useEffect(() => {
    if (busy !== 'generate') return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const [source, subjectId, gradeId, freeGradeId] = useWatch({
    control,
    name: ['source', 'subjectId', 'gradeId', 'freeGradeId'],
  })
  const topicId = useWatch({ control, name: 'topicId' })
  const subject = subjects.find((item) => item.id === subjectId)
  const grade = subject?.grades.find((item) => item.id === gradeId)
  const allGrades = subjects.flatMap((item) => item.grades.map((g) => ({ id: g.id, label: `${item.name} · ${g.name}` })))
  // What is missing goes under its field; what the server said, under the form.
  const topicError = errors.topicId?.message ?? null
  const titleError = errors.title?.message ?? null

  async function post(url: string, body: unknown): Promise<{ id: string; dropped?: number }> {
    const failure = t('worksheets:new.createFailed')
    const data = await requestJson<{ id: string; dropped: number }>(url, jsonBody('POST', body), failure)
    if (!data.id) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
    return { id: data.id, dropped: data.dropped }
  }

  async function run(kind: 'generate' | 'blank', values: WorksheetValues) {
    setBusy(kind)
    const brief = { instructions: values.instructions, ownText: values.ownText, onlyMaterials: values.onlyMaterials }
    try {
      if (kind === 'generate') {
        const { id, dropped } = await post(
          '/api/worksheets/generate',
          values.source === 'topic'
            ? { source: values.source, topicId: values.topicId, ...brief }
            : { source: values.source, title: values.title, gradeId: values.freeGradeId || null, ...brief },
        )
        if (mounted.current) router.push(dropped ? `/listy/${id}?vynechano=${dropped}` : `/listy/${id}`)
      } else {
        const name =
          values.source === 'topic'
            ? (grade?.topics.find((item) => item.id === values.topicId)?.name ?? '')
            : values.title
        const { id } = await post('/api/tests', {
          kind: 'pracovni_list',
          title: name,
          description: null,
          graded: false,
          templateId,
          topicId: values.source === 'topic' ? values.topicId : null,
          gradeId: values.source === 'topic' ? values.gradeId : values.freeGradeId || null,
          brief: JSON.stringify({ title: name, ...brief }),
          header: emptyHeader(),
          variants: 1,
          showKey: true,
          items: [],
        })
        router.push(`/listy/${id}`)
      }
    } catch (runError) {
      setError('root', { message: errorMessage(runError, t('worksheets:new.createFailed')) })
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="ui-page-title flex items-center gap-2">
        <KindMark kind="pracovni_list" />
        {t('worksheets:new.title')}
      </h1>

      <Card className="space-y-5 p-5">
        <Tabs value={source} onValueChange={(value) => setValue('source', value as WorksheetValues['source'])}>
          <TabsList>
            <TabsTrigger value="topic">{t('worksheets:new.fromTopic')}</TabsTrigger>
            <TabsTrigger value="free">{t('worksheets:new.free')}</TabsTrigger>
          </TabsList>

          <TabsContent value="topic" className="mt-4">
            {subjects.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('worksheets:new.emptyLibrary')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="list-subject">{t('worksheets:new.subject')}</Label>
                  <Select
                    value={subjectId}
                    onValueChange={(value) => {
                      setValue('subjectId', value)
                      setValue('gradeId', '')
                      setValue('topicId', '')
                    }}
                  >
                    <SelectTrigger id="list-subject" className="w-full">
                      <SelectValue placeholder={t('worksheets:new.pickSubject')} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="list-grade">{t('worksheets:new.grade')}</Label>
                  <Select
                    value={gradeId}
                    disabled={!subject}
                    onValueChange={(value) => {
                      setValue('gradeId', value)
                      setValue('topicId', '')
                    }}
                  >
                    <SelectTrigger id="list-grade" className="w-full">
                      <SelectValue placeholder={t('worksheets:new.pickGrade')} />
                    </SelectTrigger>
                    <SelectContent>
                      {subject?.grades.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="list-topic">{t('worksheets:new.topic')}</Label>
                  <Select value={topicId} disabled={!grade} onValueChange={(value) => setValue('topicId', value)}>
                    <SelectTrigger
                      id="list-topic"
                      className="w-full"
                      aria-invalid={topicError ? true : undefined}
                      aria-describedby={topicError ? 'list-topic-error' : undefined}
                    >
                      <SelectValue placeholder={t('worksheets:new.pickTopic')} />
                    </SelectTrigger>
                    <SelectContent>
                      {grade?.topics.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {topicError ? (
                  <p id="list-topic-error" className="text-sm text-danger sm:col-span-3">
                    {topicError}
                  </p>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="free" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <Label htmlFor="list-title">{t('worksheets:new.about')}</Label>
                <Input
                  id="list-title"
                  defaultValue=""
                  maxLength={200}
                  placeholder={t('worksheets:new.aboutPlaceholder')}
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby={titleError ? 'list-title-error' : undefined}
                  {...register('title')}
                />
                {titleError ? (
                  <p id="list-title-error" className="mt-1 text-sm text-danger">
                    {titleError}
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="list-free-grade">{t('worksheets:new.grade')}</Label>
                <Select
                  value={freeGradeId}
                  onValueChange={(value) => setValue('freeGradeId', value === NO_GRADE ? '' : value)}
                >
                  <SelectTrigger id="list-free-grade" className="w-full">
                    <SelectValue placeholder={t('worksheets:new.noGrade')} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* A grade once picked can be reset back to none. */}
                    <SelectItem value={NO_GRADE}>{t('worksheets:new.noGrade')}</SelectItem>
                    {allGrades.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div>
          <Label htmlFor="list-instructions">{t('worksheets:new.instructions')}</Label>
          <Input
            id="list-instructions"
            defaultValue=""
            maxLength={limits.instructionsMax}
            placeholder={t('worksheets:new.instructionsPlaceholder')}
            {...register('instructions')}
          />
        </div>

        <div>
          <Label htmlFor="list-own-text">{t('worksheets:new.ownText')}</Label>
          <Textarea
            id="list-own-text"
            defaultValue=""
            maxLength={limits.ownTextMax}
            rows={5}
            placeholder={t('worksheets:new.ownTextPlaceholder')}
            {...register('ownText')}
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <Controller
              control={control}
              name="onlyMaterials"
              render={({ field }) => (
                <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
              )}
            />
            {t('worksheets:new.onlyMaterials')}
          </label>
          <p className="mt-1 text-xs text-fg-muted">{t('worksheets:new.onlyMaterialsHint')}</p>
        </div>

        {!ai.configured ? (
          // Without a model generation is not offered at all — the button would only fail.
          <div className="rounded-[var(--radius-inner)] bg-surface-muted px-3 py-2 text-sm text-fg-soft">
            <p data-testid="worksheet-not-configured">{t('worksheets:new.notConfigured')}</p>
            {ai.problems.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-fg-muted">
                {ai.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {errors.root?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.message}
          </p>
        ) : null}
        {busy === 'generate' ? (
          <p className="text-sm text-fg-muted" role="status">
            {t('worksheets:new.generating')}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void handleSubmit((values) => run('blank', values))()}>
            {busy === 'blank' ? t('worksheets:new.creating') : t('worksheets:new.createBlank')}
          </Button>
          {ai.configured ? (
            <Button disabled={busy !== null} onClick={() => void handleSubmit((values) => run('generate', values))()}>
              {busy === 'generate' ? t('worksheets:new.generatingButton') : t('worksheets:new.generate')}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
