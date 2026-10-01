'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
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

/** The "Bez ročníku" (no grade) option — Select cannot use an empty value as an item. */
const NO_GRADE = 'bez-rocniku'

export interface WorksheetSubject {
  id: string
  name: string
  grades: { id: string; name: string; topics: { id: string; name: string }[] }[]
}

type Source = 'topic' | 'free'

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
  const [source, setSource] = useState<Source>(subjects.length > 0 ? 'topic' : 'free')
  const [subjectId, setSubjectId] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [topicId, setTopicId] = useState('')
  const [title, setTitle] = useState('')
  const [freeGradeId, setFreeGradeId] = useState('')
  const [instructions, setInstructions] = useState('')
  const [ownText, setOwnText] = useState('')
  const [busy, setBusy] = useState<'generate' | 'blank' | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const subject = subjects.find((item) => item.id === subjectId)
  const grade = subject?.grades.find((item) => item.id === gradeId)
  const topic = grade?.topics.find((item) => item.id === topicId)
  const allGrades = subjects.flatMap((item) => item.grades.map((g) => ({ id: g.id, label: `${item.name} · ${g.name}` })))

  /** What is missing to submit; `null` when the brief is complete. */
  function missing(): string | null {
    if (source === 'topic' && !topic) return t('worksheets:new.missingTopic')
    if (source === 'free' && !title.trim()) return t('worksheets:new.missingTitle')
    return null
  }

  async function post(url: string, body: unknown): Promise<{ id: string; dropped?: number }> {
    const failure = t('worksheets:new.createFailed')
    const data = await requestJson<{ id: string; dropped: number }>(url, jsonBody('POST', body), failure)
    if (!data.id) throw new Error(`${failure} ${t('common:errors.serverTrouble')}`)
    return { id: data.id, dropped: data.dropped }
  }

  async function run(kind: 'generate' | 'blank') {
    const problem = missing()
    if (problem) return setError(problem)
    setError(null)
    setBusy(kind)
    const brief = { instructions: instructions.trim(), ownText: ownText.trim() }
    try {
      if (kind === 'generate') {
        const { id, dropped } = await post(
          '/api/worksheets/generate',
          source === 'topic'
            ? { source, topicId, ...brief }
            : { source, title: title.trim(), gradeId: freeGradeId || null, ...brief },
        )
        if (mounted.current) router.push(dropped ? `/listy/${id}?vynechano=${dropped}` : `/listy/${id}`)
      } else {
        const name = source === 'topic' ? topic!.name : title.trim()
        const { id } = await post('/api/tests', {
          kind: 'pracovni_list',
          title: name,
          description: null,
          graded: false,
          templateId,
          topicId: source === 'topic' ? topicId : null,
          gradeId: source === 'topic' ? gradeId : freeGradeId || null,
          brief: JSON.stringify({ title: name, ...brief }),
          header: emptyHeader(),
          variants: 1,
          showKey: true,
          items: [],
        })
        router.push(`/listy/${id}`)
      }
    } catch (runError) {
      setError(errorMessage(runError, t('worksheets:new.createFailed')))
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="ui-page-title">{t('worksheets:new.title')}</h1>

      <Card className="space-y-5 p-5">
        <Tabs value={source} onValueChange={(value) => setSource(value as Source)}>
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
                      setSubjectId(value)
                      setGradeId('')
                      setTopicId('')
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
                      setGradeId(value)
                      setTopicId('')
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
                  <Select value={topicId} disabled={!grade} onValueChange={setTopicId}>
                    <SelectTrigger id="list-topic" className="w-full">
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
              </div>
            )}
          </TabsContent>

          <TabsContent value="free" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <Label htmlFor="list-title">{t('worksheets:new.about')}</Label>
                <Input
                  id="list-title"
                  value={title}
                  maxLength={200}
                  placeholder={t('worksheets:new.aboutPlaceholder')}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="list-free-grade">{t('worksheets:new.grade')}</Label>
                <Select
                  value={freeGradeId}
                  onValueChange={(value) => setFreeGradeId(value === NO_GRADE ? '' : value)}
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
            value={instructions}
            maxLength={limits.instructionsMax}
            placeholder={t('worksheets:new.instructionsPlaceholder')}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="list-own-text">{t('worksheets:new.ownText')}</Label>
          <Textarea
            id="list-own-text"
            value={ownText}
            maxLength={limits.ownTextMax}
            rows={5}
            placeholder={t('worksheets:new.ownTextPlaceholder')}
            onChange={(event) => setOwnText(event.target.value)}
          />
        </div>

        {!ai.configured ? (
          // Without a model generation is not offered at all — the button would only fail.
          <div className="rounded-[var(--radius-inner)] bg-surface-muted px-3 py-2 text-sm text-fg-soft">
            <p>{t('worksheets:new.notConfigured')}</p>
            {ai.problems.length > 0 ? (
              <ul className="mt-1 list-disc pl-5 text-fg-muted">
                {ai.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {busy === 'generate' ? (
          <p className="text-sm text-fg-muted" role="status">
            {t('worksheets:new.generating')}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void run('blank')}>
            {busy === 'blank' ? t('worksheets:new.creating') : t('worksheets:new.createBlank')}
          </Button>
          {ai.configured ? (
            <Button disabled={busy !== null} onClick={() => void run('generate')}>
              {busy === 'generate' ? t('worksheets:new.generatingButton') : t('worksheets:new.generate')}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
