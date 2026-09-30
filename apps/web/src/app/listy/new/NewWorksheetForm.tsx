'use client'

import { useState } from 'react'
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

export interface WorksheetSubject {
  id: string
  name: string
  grades: { id: string; name: string; topics: { id: string; name: string }[] }[]
}

type Source = 'topic' | 'free'

/**
 * Formulář „Nový pracovní list“. List vzniká z tématu knihovny, nebo
 * z volného zadání (název a ročník); k obojímu jde připsat pokyn a vložit
 * vlastní text. Bez nastaveného modelu se generování nenabízí a zbývá
 * prázdný list k ručnímu vyplnění.
 */
export function NewWorksheetForm({
  subjects,
  templateId,
  ai,
  limits,
}: {
  subjects: WorksheetSubject[]
  /** Šablona prázdného listu — první podle pořadí, jako u nové písemky. */
  templateId: string
  ai: { configured: boolean; problems: string[] }
  /** Meze pokynu a vlastního textu z `AI_SETTINGS.worksheet` — hlídá je i server. */
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

  const subject = subjects.find((item) => item.id === subjectId)
  const grade = subject?.grades.find((item) => item.id === gradeId)
  const topic = grade?.topics.find((item) => item.id === topicId)
  const allGrades = subjects.flatMap((item) => item.grades.map((g) => ({ id: g.id, label: `${item.name} · ${g.name}` })))

  /** Co chybí k odeslání; `null`, když je zadání úplné. */
  function missing(): string | null {
    if (source === 'topic' && !topic) return 'Vyber předmět, ročník a téma.'
    if (source === 'free' && !title.trim()) return 'Napiš, o čem má list být.'
    return null
  }

  async function post(url: string, body: unknown): Promise<{ id: string; dropped?: number }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as { id?: string; dropped?: number; error?: string }
    if (!response.ok || !data.id) throw new Error(data.error ?? `Požadavek selhal (${response.status})`)
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
        router.push(dropped ? `/listy/${id}?vynechano=${dropped}` : `/listy/${id}`)
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
      setError(runError instanceof Error ? runError.message : String(runError))
      setBusy(null)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="ui-page-title">Nový pracovní list</h1>

      <Card className="space-y-5 p-5">
        <Tabs value={source} onValueChange={(value) => setSource(value as Source)}>
          <TabsList>
            <TabsTrigger value="topic">Téma z knihovny</TabsTrigger>
            <TabsTrigger value="free">Volné zadání</TabsTrigger>
          </TabsList>

          <TabsContent value="topic" className="mt-4">
            {subjects.length === 0 ? (
              <p className="text-sm text-fg-muted">Knihovna je zatím prázdná. Použij volné zadání.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="list-subject">Předmět</Label>
                  <Select
                    value={subjectId}
                    onValueChange={(value) => {
                      setSubjectId(value)
                      setGradeId('')
                      setTopicId('')
                    }}
                  >
                    <SelectTrigger id="list-subject" className="w-full">
                      <SelectValue placeholder="Vyber předmět" />
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
                  <Label htmlFor="list-grade">Ročník</Label>
                  <Select
                    value={gradeId}
                    disabled={!subject}
                    onValueChange={(value) => {
                      setGradeId(value)
                      setTopicId('')
                    }}
                  >
                    <SelectTrigger id="list-grade" className="w-full">
                      <SelectValue placeholder="Vyber ročník" />
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
                  <Label htmlFor="list-topic">Téma</Label>
                  <Select value={topicId} disabled={!grade} onValueChange={setTopicId}>
                    <SelectTrigger id="list-topic" className="w-full">
                      <SelectValue placeholder="Vyber téma" />
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
                <Label htmlFor="list-title">O čem má list být</Label>
                <Input
                  id="list-title"
                  value={title}
                  placeholder="Např. Vánoce v Evropě"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="list-free-grade">Ročník</Label>
                <Select value={freeGradeId} onValueChange={setFreeGradeId}>
                  <SelectTrigger id="list-free-grade" className="w-full">
                    <SelectValue placeholder="Bez ročníku" />
                  </SelectTrigger>
                  <SelectContent>
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
          <Label htmlFor="list-instructions">Pokyn pro model (nepovinné)</Label>
          <Input
            id="list-instructions"
            value={instructions}
            maxLength={limits.instructionsMax}
            placeholder="Např. víc tabulek, jeden fun fact, na 20 minut"
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="list-own-text">Vlastní text (nepovinné)</Label>
          <Textarea
            id="list-own-text"
            value={ownText}
            maxLength={limits.ownTextMax}
            rows={5}
            placeholder="Sem můžeš vložit text, ze kterého má list vycházet — třeba úryvek z učebnice."
            onChange={(event) => setOwnText(event.target.value)}
          />
        </div>

        {!ai.configured ? (
          // Bez modelu se generování nenabízí vůbec — tlačítko by skončilo chybou.
          <div className="rounded-[var(--radius-inner)] bg-surface-muted px-3 py-2 text-sm text-fg-soft">
            <p>Generování listu není nastavené, takže ho model připravit nemůže. Založ prázdný list a vyplň ho ručně.</p>
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

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void run('blank')}>
            {busy === 'blank' ? 'Zakládám…' : 'Založit prázdný list'}
          </Button>
          {ai.configured ? (
            <Button disabled={busy !== null} onClick={() => void run('generate')}>
              {busy === 'generate' ? 'Generuji list… (může to trvat minutu)' : 'Vygenerovat'}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
