'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type Question } from '@testmaker/core/schema'
import { Button, Card, EmptyState, MATERIALY_Z, OTAZKY, plural, pocet, toast } from '@testmaker/ui'
import {
  AiUnavailable,
  DEFAULT_SIMPLE_SETTINGS,
  ProgressLine,
  SimpleGenerateSettingsForm,
  type SimpleGenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
import { ClaudeCodeImport } from '@/components/ClaudeCodeImport'
import type { GroupMaterial } from '@/components/MaterialRow'
import { MaterialsStrip, type MaterialsStripHandle } from '@/components/MaterialsStrip'
import { TopicQuestions, type TestUsage, type TopicQuestionsHandle, type VariantLink } from '@/components/TopicQuestions'
import { generateQuestionsStream } from '@/lib/generateClient'
import { errorMessage } from '@/lib/requestJson'
import { isUsableMaterial, MIN_GENERATE_CHARS } from '@/lib/materials'
import { useMuzeMenit } from '@/components/Prava'

export function TopicWorkspace({
  topic,
  defaultTemplateId,
  materials,
  questions,
  usage,
  rejectedCount,
  variantLinks,
  listTruncated,
  listLimit,
  lowContent,
  usableCharCount,
  ai,
}: {
  /** Metadata tématu potřebná k založení testu rovnou z výběru otázek. */
  topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }
  /** Výchozí šablona nové písemky (stejná volba jako u testu z prázdna). */
  defaultTemplateId: string
  /** Materiály tématu — beze změny se předávají i do pruhu materiálů pod hlavní akcí. */
  materials: GroupMaterial[]
  questions: Question[]
  /** Testy, ve kterých už otázky jsou — jen ty, na které je volající vidí. */
  usage: Record<string, TestUsage[]>
  /** Počet smazaných (zamítnutých) otázek tématu — pro přepínač „Smazané". */
  rejectedCount: number
  /** Lehčí a těžší verze podle kořene, pro řádek „Verze: …" na kartě otázky. */
  variantLinks: Record<string, VariantLink[]>
  /** Seznam otázek je useknutý limitem — v tématu jich je víc, než se vypisuje. */
  listTruncated: boolean
  /** Kolik otázek se nejvýš vypisuje; do hlášky o useknutém seznamu. */
  listLimit: number
  /** Použitelného textu (bez duplicit) je málo na písemku — generování zůstává možné, jen ne jako výchozí volba. */
  lowContent: boolean
  /** Použitelný text tématu ve znacích — stejné číslo, které karta ukazuje ve `StatRow`. */
  usableCharCount: number
  ai: { configured: boolean; provider: string; model: string; problems: string[] }
}) {
  const muzeMenit = useMuzeMenit()
  const router = useRouter()
  const [settings, setSettings] = useState<SimpleGenerateSettings>(DEFAULT_SIMPLE_SETTINGS)
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Otázky vytvořené v tomhle běhu. Seznam níž se obnovuje až po doběhnutí
   * (router.refresh), a čekat na to znamená deset minut koukat na kolečko —
   * tyhle se do seznamu přidají hned, jak je server uloží.
   */
  const [fresh, setFresh] = useState<Question[]>([])
  /** Dokončený běh: souhrn zůstane na obrazovce i po zmizení hlášky. */
  const [outcome, setOutcome] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const materialsStripRef = useRef<MaterialsStripHandle>(null)
  const topicQuestionsRef = useRef<TopicQuestionsHandle>(null)
  // Nahrání prvního materiálu nebo napsání první otázky z prázdného stavu
  // odkrývá zbytek stránky ještě dřív, než dojede `router.refresh()` — jinak
  // by tlačítko v `EmptyState` muselo mířit na skrytou plochu.
  const [revealed, setRevealed] = useState(false)
  // Zatímco se v pruhu materiálů čte nebo ukládá soubor, generování by sáhlo
  // po textu, který ještě není hotový — tlačítko proto počká, než se pruh
  // ohlásí jako volný.
  const [materialsUploading, setMaterialsUploading] = useState(false)

  // Generování běží jen s otevřenou stránkou — zavření nebo obnovení ho
  // utne, proto se prohlížeč napřed zeptá.
  useEffect(() => {
    if (!generating) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [generating])

  // Po obnovení seznamu přijdou tytéž otázky i v `questions` — podle id se
  // proto čerstvé, které už v seznamu jsou, vynechají, ať se nezdvojí.
  const shownQuestions = useMemo(() => {
    const known = new Set(questions.map((question) => question.id))
    return [...fresh.filter((question) => !known.has(question.id)), ...questions]
  }, [fresh, questions])

  // Ukazujeme jen to, co skutečně půjde do modelu: generování duplicitní
  // obsah, ručně vynechaný materiál i sken bez textové vrstvy vždycky
  // přeskočí, takže se nesmí počítat ani tady — jinak na obrazovce stojí
  // velké číslo a hned pod ním upozornění, že materiálů je málo.
  const usable = materials.filter(isUsableMaterial)
  // Stejná hranice, jakou generování hlídá na serveru (`MIN_GENERATE_CHARS`) —
  // tlačítko se zakáže dřív, než by učitelka čekala na chybovou hlášku.
  const tooLittleText = usableCharCount < MIN_GENERATE_CHARS
  // Téma úplně bez obsahu (žádný materiál, žádná otázka) dostane jednotnou
  // výzvu místo karty generování a pruhu materiálů — obojí by jen ukazovalo
  // vlastní prázdný stav vedle sebe.
  const isEmpty = materials.length === 0 && questions.length === 0
  const showEmptyState = isEmpty && muzeMenit && !revealed

  async function generate() {
    setError(null)
    setGenerating(true)
    setOutcome(null)
    setFresh([])
    setStatus('Spouštím generování…')
    announceGeneration()
    abortRef.current = new AbortController()
    // Průběh se skládá ze dvou údajů: kolik otázek už je hotových (to učitelku
    // zajímá) a kde se model v materiálech nachází (to jen dokresluje, jak
    // dlouho to ještě potrvá).
    let hotovo = 0
    let cast: { done: number; total: number } | null = null
    // Stream, který skončí bez `done` i bez `error` (spadlé spojení, vypršelá
    // funkce), dřív skončil potichu — kolečko zmizelo a nic se neřeklo.
    let started = false
    let finished = false
    const interrupted = () => {
      setStatus(null)
      setError('Generování se přerušilo — vzniklé otázky jsou uložené, zbytek spusť znovu.')
      router.refresh()
    }
    const prubeh = () => {
      const otazky = hotovo > 0 ? `Hotovo ${pocet(hotovo, OTAZKY)}` : 'Zatím žádná otázka není hotová'
      // `done` je počet už zpracovaných částí; pracuje se tedy na následující.
      // Když je hotová i poslední, žádná další už nezbývá a nemá se co hlásit.
      const zbyva = cast && cast.done < cast.total
      setStatus(zbyva ? `${otazky} · pracuji na části ${cast!.done + 1} z ${cast!.total}` : otazky)
    }

    try {
      // Typy i režim se v tématu nevybírají — posílá se pevně všechno, co
      // model umí, a vždycky se přidávají nové otázky (nikdy „doplnit na
      // celkový počet"), to je pro hromadné generování, ne pro jedno téma.
      await generateQuestionsStream(
        { topicId: topic.id, count: settings.count, difficulty: settings.difficulty, types: [...AI_QUESTION_TYPES] },
        (event) => {
          started = true
          if (event.type === 'done' || event.type === 'error') finished = true
          if (event.type === 'progress') {
            cast = { done: event.done, total: event.total }
            prubeh()
          } else if (event.type === 'saved') {
            hotovo = event.created
            // Nejnovější nahoře — stejně jako seznam otázek pod tím.
            setFresh((current) => [...event.questions.slice().reverse(), ...current])
            prubeh()
          } else if (event.type === 'done') {
            setStatus(null)
            // Podrobný souhrn (co se zahodilo, kolikrát model selhal) má jedno
            // místo — trvalý řádek v kartě. Bublina jen upozorní, že je hotovo,
            // ať se táž věta nečte dvakrát vedle sebe.
            setOutcome(summarizeRun(event))
            toast.success(
              event.created > 0
                ? `Hotovo, ${event.created} ${plural(event.created, 'nová', 'nové', 'nových')} ${plural(event.created, ...OTAZKY)}.`
                : 'Hotovo, ale nevznikla ani jedna otázka.',
              { duration: 12_000 },
            )
            router.refresh()
          } else if (event.type === 'error') setError(event.message)
        },
        abortRef.current.signal,
      )
      if (!finished) interrupted()
    } catch (streamError) {
      if (started && !finished) interrupted()
      else setError(errorMessage(streamError, 'Generování se nepodařilo.'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div
      className="space-y-5"
      // Přetažení souboru mimo pruh materiálů by prohlížeč defaultně otevřel
      // jako novou stránku a učitelka by o rozpracovanou práci přišla. Celá
      // plocha tématu proto přetažení přebírá a posílá ho do pruhu, jako by
      // ho pustila přímo na jeho ploše — vlastní zóna pruhu přetažení dál
      // nepouští (`stopPropagation`), ať se totéž nezpracuje dvakrát.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (muzeMenit) materialsStripRef.current?.handleExternalDrop(event.dataTransfer)
      }}
    >
      {/* Téma úplně bez obsahu dostane jednu jasnou výzvu místo karty
          generování a pruhu materiálů — obojí by tu jen ukazovalo vlastní
          prázdný stav vedle sebe. Zmizí sama, jakmile něco přibude
          (`router.refresh()` po uložení), `revealed` jen předbíhá, než dojede. */}
      {showEmptyState ? (
        <EmptyState
          title="Téma je zatím prázdné."
          hint="Nahraj materiál, ze kterého mají vzniknout otázky, nebo si první otázku napiš sama."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                onClick={() => {
                  setRevealed(true)
                  materialsStripRef.current?.openUpload()
                }}
              >
                Nahrát materiál
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setRevealed(true)
                  topicQuestionsRef.current?.openCreate()
                }}
              >
                Napsat otázku
              </Button>
            </div>
          }
        />
      ) : ai.configured && muzeMenit ? (
        /* Náhled si téma prohlíží a tiskne, ale negeneruje — karta by mu jen
           nabízela tlačítko, které skončí odmítnutím. */
        <Card className="gap-2 p-3">
          {/* Karta byla nadpis, dva odstavce a teprve pak tlačítko. Podstatné
              je jediné: tlačítko, kolik otázek vznikne a kde se to doladí —
              zbytek patří do nastavení, které je hned vedle. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={lowContent ? 'outline' : 'default'}
              disabled={generating || usable.length === 0 || tooLittleText || materialsUploading}
              onClick={() => void generate()}
            >
              Vygenerovat otázky
            </Button>
            <span className="text-sm text-fg-muted">
              {materialsUploading
                ? 'Počkej, až se soubory nahrají.'
                : usable.length === 0
                  ? 'Nejdřív nahraj materiál nebo ho zapni pro generování.'
                  : tooLittleText
                    ? 'Použitelného textu je zatím míň než 200 znaků — na otázky to nestačí.'
                    : `Vznikne ${pocet(settings.count, OTAZKY)} z ${pocet(usable.length, MATERIALY_Z)}.`}
            </span>
            <div className="ml-auto">
              <SimpleGenerateSettingsForm value={settings} onChange={setSettings} disabled={generating} />
            </div>
          </div>

          {lowContent ? (
            <p className="text-sm text-fg-muted">
              Materiálů je v tomhle tématu málo — otázek vznikne jen pár a budou se opakovat.
            </p>
          ) : null}

          {generating ? <ProgressLine label={status ?? 'Spouštím generování…'} /> : null}

          {/* Souhrn běhu zůstává na obrazovce i po zmizení hlášky — nové otázky
              jsou hned vidět jako karty pod tím, není kam dál chodit. */}
          {!generating && outcome ? <p className="text-sm text-fg-soft">{outcome}</p> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </Card>
      ) : muzeMenit ? (
        <AiUnavailable problems={ai.problems} />
      ) : null}

      {muzeMenit && !showEmptyState ? <ClaudeCodeImport topicId={topic.id} /> : null}

      <div className={showEmptyState ? 'hidden' : undefined}>
        <MaterialsStrip
          ref={materialsStripRef}
          topicId={topic.id}
          topicName={topic.name}
          materials={materials}
          onBusyChange={setMaterialsUploading}
        />
      </div>

      {listTruncated ? (
        <p className="text-sm text-fg-muted">
          Otázek je v tomhle tématu víc, než se sem vejde — vypisuje se prvních {listLimit}{' '}
          od nejnovější. Zbytek najdeš v bance otázek, kde se dá filtrovat i hledat.
        </p>
      ) : null}

      <div className={showEmptyState ? 'hidden' : undefined}>
        <TopicQuestions
          ref={topicQuestionsRef}
          topic={topic}
          defaultTemplateId={defaultTemplateId}
          questions={shownQuestions}
          usage={usage}
          rejectedCount={rejectedCount}
          variantLinks={variantLinks}
        />
      </div>
    </div>
  )
}

/**
 * Věta o tom, jak generování dopadlo: kolik otázek vzniklo, kolik se zahodilo
 * a proč. Zahozené otázky nejsou chyba učitelky — ale když jich je hodně,
 * je to jediná stopa po tom, že model nad materiálem tápe.
 */
function summarizeRun(event: {
  created: number
  rejected: number
  failedCalls: number
  sources: number
  models?: string[]
}): string {
  if (event.created === 0) {
    return 'Nevznikla ani jedna otázka. Zkus to prosím znovu, případně s menším počtem otázek.'
  }
  const parts = [`Vytvořeno ${pocet(event.created, OTAZKY)}.`]
  if (event.rejected > 0) {
    // Věta nesmí záviset na počtu: „1 otázka — byly neúplné“ se neshodovalo.
    parts.push(`Zahozeno: ${pocet(event.rejected, OTAZKY)} — neúplné nebo si odporovaly.`)
  }
  if (event.failedCalls > 0) {
    parts.push(`${event.failedCalls}× model odpověděl něčím, co se nedalo použít.`)
  }
  // Když se v jednom tématu vystřídalo víc modelů, otázky nemusí být stejně
  // kvalitní — učitelka to má vědět dřív, než je začne číst.
  if ((event.models?.length ?? 0) > 1) parts.push('Otázky psalo víc různých modelů, kvalita se může lišit.')
  return parts.join(' ')
}
