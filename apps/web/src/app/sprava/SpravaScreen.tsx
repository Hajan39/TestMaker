'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
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
  toast,
} from '@testmaker/ui'
import { REGENERATE_REASONS, type RegenerateReason } from '@testmaker/core/schema'
import { SkolaFormular } from '@/components/SkolaFormular'
import type { AiQuality } from '@/lib/aiQuality'
import type { PromptRule } from '@/lib/promptRules'
import {
  ROLES_PRIDELITELNE,
  ROLE_LABELS,
  USER_STATUS_LABELS,
  roleJeAdministrator,
  type Role,
  type UserStatus,
} from '@/lib/role'

export interface UcetRadek {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  maHeslo: boolean
  maGoogle: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
}

export interface UdalostRadek {
  id: string
  at: string
  action: string
  entity: string | null
  entityId: string | null
  detail: unknown
  severity: 'info' | 'chyba'
  kdo: string | null
}

/** Datum a čas tak, jak se čtou v češtině. */
function kdy(hodnota: string | null): string {
  if (!hodnota) return '—'
  const datum = new Date(hodnota)
  return Number.isNaN(datum.getTime()) ? hodnota : datum.toLocaleString('cs-CZ')
}

/** Událost zapsal administrátor zvenku — `zapsatAudit` jí dal příznak. */
function odAdministratora(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && (detail as { administrator?: unknown }).administrator === true
}

export function SpravaScreen({
  ja,
  skola,
  googleDomain,
  googleAutoJoin,
  uzivatele,
  udalosti,
  fronta,
  aiKvalita,
  aiConfigured,
  aiProblems,
  prihlasovani,
  pravidla,
  maxPravidel,
}: {
  ja: string
  skola: string
  googleDomain: string | null
  googleAutoJoin: boolean
  uzivatele: UcetRadek[]
  udalosti: UdalostRadek[]
  fronta: { queued: number; running: number; done: number; error: number }
  aiKvalita: AiQuality
  aiConfigured: boolean
  /** Proč v žebříčku modelů něco chybí (`describeAiSetup`) — pro majitele. */
  aiProblems: string[]
  prihlasovani: 'zapnuto' | 'vypnuto' | 'chybne-nastaveno'
  /** Pravidla promptu školy — nejnovější první. */
  pravidla: PromptRule[]
  /** Kolik aktivních pravidel smí být nejvýš (`MAX_ACTIVE_PROMPT_RULES`). */
  maxPravidel: number
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [jmeno, setJmeno] = useState('')
  const [role, setRole] = useState<Role>('ucitelka')
  const [busy, setBusy] = useState(false)
  /**
   * Vygenerované heslo se ukazuje jednou a jen tady: nikam se neposílá
   * a podruhé ho nikdo nezjistí, protože v databázi je jen otisk.
   */
  const [heslo, setHeslo] = useState<{ email: string; heslo: string } | null>(null)

  // Rozpracované pravidlo z tlačítka „Udělat z toho pravidlo" — předvyplněné
  // z nápovědy důvodu, ale správce ho může před uložením upravit.
  const [novePravidlo, setNovePravidlo] = useState<{ reason: RegenerateReason; text: string } | null>(null)
  const [pravidloBusy, setPravidloBusy] = useState(false)

  async function ulozitPravidlo() {
    if (!novePravidlo) return
    setPravidloBusy(true)
    try {
      const response = await fetch('/api/prompt-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: novePravidlo.text, reason: novePravidlo.reason }),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        toast.error(data.error ?? 'Pravidlo se nepodařilo uložit.')
        return
      }
      toast.success('Pravidlo uloženo a hned se použije při dalším generování.')
      setNovePravidlo(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Pravidlo se nepodařilo uložit.')
    } finally {
      setPravidloBusy(false)
    }
  }

  async function prepnoutPravidlo(id: string, active: boolean) {
    try {
      const response = await fetch('/api/prompt-rules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, active }),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        toast.error(data.error ?? 'Změna se nepovedla.')
        return
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Změna se nepovedla.')
    }
  }

  async function zalozit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    const response = await fetch('/api/sprava/uzivatele', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: jmeno, role }),
    })
    setBusy(false)
    const data = (await response.json()) as { heslo?: string; error?: string }
    if (!response.ok) {
      toast.error(data.error ?? 'Účet se nepodařilo založit.')
      return
    }
    setHeslo({ email, heslo: data.heslo ?? '' })
    setEmail('')
    setJmeno('')
    router.refresh()
  }

  async function ulozitSkolu(nastaveni: {
    name: string
    googleDomain: string
    googleAutoJoin: boolean
  }): Promise<boolean> {
    const response = await fetch('/api/sprava/skola', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nastaveni),
    })
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) {
      toast.error(data.error ?? 'Školu se nepodařilo uložit.')
      return false
    }
    toast.success('Škola uložena.')
    router.refresh()
    return true
  }

  async function upravit(id: string, zmeny: Record<string, unknown>, hlaska: string) {
    const response = await fetch('/api/sprava/uzivatele', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...zmeny }),
    })
    const data = (await response.json()) as { heslo?: string; error?: string }
    if (!response.ok) {
      toast.error(data.error ?? 'Změna se nepovedla.')
      return
    }
    if (data.heslo) {
      const ucet = uzivatele.find((row) => row.id === id)
      setHeslo({ email: ucet?.email ?? '', heslo: data.heslo })
    }
    toast.success(hlaska)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">Správa — {skola}</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">
          Účty učitelek, záznam událostí a stav provozu. Třídy i otázky v nich jsou společné pro
          celou školu; písemky a hlavolamy patří té, kdo je vytvořila.
        </p>
      </div>

      <Tabs defaultValue="ucty">
        <TabsList>
          <TabsTrigger value="ucty">Účty</TabsTrigger>
          <TabsTrigger value="udalosti">Události a chyby</TabsTrigger>
          <TabsTrigger value="provoz">Provoz</TabsTrigger>
          <TabsTrigger value="ai-kvalita">AI kvalita</TabsTrigger>
        </TabsList>

        <TabsContent value="ucty" className="space-y-4">
          {heslo ? (
            <Card className="border-brand bg-brand-bg/40 p-4 text-sm">
              <p className="font-medium text-fg">
                Heslo pro {heslo.email}: <code className="ui-numeric">{heslo.heslo}</code>
              </p>
              <p className="mt-1 text-fg-soft">
                Předej ho osobně. Podruhé se nezobrazí a při prvním přihlášení si ho učitelka
                změní.
              </p>
              <Button className="mt-2" size="sm" variant="ghost" onClick={() => setHeslo(null)}>
                Skrýt
              </Button>
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="font-medium text-fg">Škola</h2>
            <p className="mt-1 mb-3 max-w-3xl text-sm text-fg-soft">
              S doménou se učitelky přihlásí školním účtem Google. Když je zapnuté evidování, účet
              z domény, který tu ještě není, se zaeviduje a čeká, až mu přidělíš roli.
            </p>
            <SkolaFormular
              vychozi={{ name: skola, googleDomain: googleDomain ?? '', googleAutoJoin }}
              tlacitko="Uložit školu"
              onUlozit={ulozitSkolu}
            />
          </Card>

          <Card className="p-4">
            <h2 className="font-medium text-fg">Nový účet</h2>
            <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={zalozit}>
              <div className="w-64">
                <Label htmlFor="novy-email">E-mail</Label>
                <Input
                  id="novy-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="w-56">
                <Label htmlFor="novy-jmeno">Jméno</Label>
                <Input
                  id="novy-jmeno"
                  value={jmeno}
                  onChange={(event) => setJmeno(event.target.value)}
                />
              </div>
              <div className="w-40">
                <Label htmlFor="nova-role">Role</Label>
                <Select value={role} onValueChange={(next) => setRole(next as Role)}>
                  <SelectTrigger id="nova-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES_PRIDELITELNE.map((hodnota) => (
                      <SelectItem key={hodnota} value={hodnota}>
                        {ROLE_LABELS[hodnota]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={busy || !email || !jmeno}>
                Založit účet
              </Button>
            </form>
          </Card>

          <div className="space-y-2">
            {uzivatele.map((ucet) => (
              <Card key={ucet.id} className="flex-row flex-wrap items-center gap-3 p-3">
                <div className="min-w-56 flex-1">
                  <p className="font-medium text-fg">
                    {ucet.name}
                    {ucet.id === ja ? <span className="ml-2 text-xs text-fg-muted">(to jsi ty)</span> : null}
                  </p>
                  <p className="text-sm text-fg-soft">{ucet.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {ucet.status !== 'aktivni' ? (
                    <Badge variant={ucet.status === 'ceka' ? 'secondary' : 'destructive'}>
                      {USER_STATUS_LABELS[ucet.status]}
                    </Badge>
                  ) : null}
                  {ucet.maGoogle ? <Badge variant="secondary">Google</Badge> : null}
                  {ucet.mustChangePassword ? <Badge variant="secondary">změní heslo</Badge> : null}
                  <span className="ui-numeric text-xs text-fg-muted">
                    naposledy {kdy(ucet.lastLoginAt)}
                  </span>
                </div>

                {roleJeAdministrator(ucet.role) ? (
                  // Administrátora spravuje jen skript u databáze; tady se
                  // jen ukáže, že ve škole je.
                  <Badge variant="secondary">{ROLE_LABELS[ucet.role]}</Badge>
                ) : (
                  <>
                    <Select
                      value={ucet.role}
                      onValueChange={(next) =>
                        void upravit(ucet.id, { role: next }, `Role změněna na ${ROLE_LABELS[next as Role]}. Účet se musí znovu přihlásit.`)
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES_PRIDELITELNE.map((hodnota) => (
                          <SelectItem key={hodnota} value={hodnota}>
                            {ROLE_LABELS[hodnota]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void upravit(ucet.id, { heslo: true }, 'Nové heslo vygenerováno.')}
                    >
                      Nové heslo
                    </Button>
                    {ucet.status === 'aktivni' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ucet.id === ja}
                        onClick={() =>
                          void upravit(ucet.id, { status: 'zablokovany' }, 'Účet zablokován a odhlášen.')
                        }
                      >
                        Zablokovat
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void upravit(ucet.id, { status: 'aktivni' }, 'Účet zpřístupněn.')}
                      >
                        Zpřístupnit
                      </Button>
                    )}
                  </>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="udalosti">
          <Card className="divide-y divide-line">
            {udalosti.length === 0 ? (
              <p className="p-4 text-sm text-fg-soft">Zatím se nic nestalo.</p>
            ) : (
              udalosti.map((udalost) => (
                <div key={udalost.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="ui-numeric w-40 shrink-0 text-xs text-fg-muted">{kdy(udalost.at)}</span>
                  <span
                    className={
                      udalost.severity === 'chyba' ? 'font-medium text-danger' : 'font-medium text-fg'
                    }
                  >
                    {udalost.action}
                  </span>
                  <span className="text-fg-soft">{udalost.kdo ?? 'bez přihlášení'}</span>
                  {odAdministratora(udalost.detail) ? <Badge variant="secondary">Administrátor</Badge> : null}
                  {udalost.detail ? (
                    <span className="text-xs text-fg-muted">{JSON.stringify(udalost.detail)}</span>
                  ) : null}
                </div>
              ))
            )}
          </Card>
        </TabsContent>

        <TabsContent value="provoz" className="space-y-3">
          <Card className="space-y-1 p-4 text-sm">
            <p>
              Fronta generování: běží {fronta.running}, čeká {fronta.queued}, hotovo {fronta.done},
              chyb {fronta.error}.
            </p>
            <p>Generování otázek: {aiConfigured ? 'nastavené' : 'není nastavené'}.</p>
            {aiProblems.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-soft">
                {aiProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <p>
              Přihlašování: {prihlasovani}
              {googleDomain ? `, Google pro doménu ${googleDomain}` : ', bez přihlášení přes Google'}.
            </p>
          </Card>
          <Card className="p-4 text-sm">
            <p className="text-fg-soft">
              Záloha celé školy je na vlastní stránce — stáhne se jeden soubor JSON a stejnou cestou
              se dá nahrát zpátky.
            </p>
            <Button className="mt-2" variant="outline" size="sm" asChild>
              <a href="/zaloha">Otevřít zálohu</a>
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="ai-kvalita" className="space-y-4">
          <p className="max-w-3xl text-sm text-fg-soft">
            Za posledních devadesát dní: kolik otázek který model vygeneroval a kolik jich učitelky
            nakonec přegenerovaly, i s nejčastějšími důvody. „Přegenerováno“ počítá jen náhrady přes
            tlačítko Přegenerovat — smazání ani ruční úpravu otázky nezahrnuje.
          </p>

          {aiKvalita.models.length === 0 ? (
            <Card className="p-4 text-sm text-fg-soft">Zatím žádná zpětná vazba.</Card>
          ) : (
            <>
              <Card className="divide-y divide-line">
                <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Modely</p>
                {aiKvalita.models.map((model) => {
                  // Bez vygenerované otázky v okně nejde spočítat podíl — „—“,
                  // ne dělení nulou. Nahoru se ořízne na 100 %: obě čísla mají
                  // vlastní devadesátidenní okno (viz komentář v aiQuality.ts),
                  // takže přegenerovaných může technicky být víc než vygenerovaných.
                  const podil =
                    model.generated > 0
                      ? `${Math.min(100, Math.round((model.regenerated / model.generated) * 100))} %`
                      : '—'
                  return (
                    <div
                      key={model.model}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                    >
                      <span className="font-medium text-fg">{model.model}</span>
                      <span className="ui-numeric text-fg-soft">
                        vygenerováno {model.generated} · přegenerováno {model.regenerated} · {podil}
                      </span>
                    </div>
                  )
                })}
              </Card>

              {aiKvalita.reasons.length > 0 ? (
                <Card className="divide-y divide-line">
                  <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Nejčastější důvody přegenerování
                  </p>
                  {aiKvalita.reasons.map((row) => (
                    <div
                      key={row.reason ?? 'bez-duvodu'}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                    >
                      <span className="text-fg">
                        {row.reason ? REGENERATE_REASONS[row.reason].label : 'bez udání důvodu'}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="ui-numeric text-fg-soft">{row.count}×</span>
                        {row.reason ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setNovePravidlo({ reason: row.reason!, text: REGENERATE_REASONS[row.reason!].rule })
                            }
                          >
                            Udělat z toho pravidlo
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </Card>
              ) : null}

              {novePravidlo ? (
                <Card className="space-y-2 p-4">
                  <h3 className="font-medium text-fg">
                    Nové pravidlo z důvodu „{REGENERATE_REASONS[novePravidlo.reason].label}“
                  </h3>
                  <p className="text-sm text-fg-soft">
                    Text se připojí ke každému dalšímu generování otázek pro tuhle školu, dokud ho
                    nevypneš. Uprav ho, jak potřebuješ.
                  </p>
                  <Textarea
                    value={novePravidlo.text}
                    maxLength={300}
                    onChange={(event) => setNovePravidlo({ ...novePravidlo, text: event.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button disabled={pravidloBusy || !novePravidlo.text.trim()} onClick={() => void ulozitPravidlo()}>
                      Uložit pravidlo
                    </Button>
                    <Button variant="ghost" onClick={() => setNovePravidlo(null)}>
                      Zrušit
                    </Button>
                  </div>
                </Card>
              ) : null}

              {aiKvalita.bySubject.length > 0 ? (
                <Card className="divide-y divide-line">
                  <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Předměty s nejvíc přegenerováním
                  </p>
                  {aiKvalita.bySubject.map((row) => (
                    <div
                      key={row.subject}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                    >
                      <span className="text-fg">{row.subject}</span>
                      <span className="ui-numeric text-fg-soft">
                        {row.regenerated}×
                        {row.topReason
                          ? ` · nejčastěji ${REGENERATE_REASONS[row.topReason].label.toLowerCase()}`
                          : ''}
                      </span>
                    </div>
                  ))}
                </Card>
              ) : null}
            </>
          )}

          <Card className="divide-y divide-line">
            <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
              Pravidla promptu školy ({pravidla.filter((p) => p.active).length}/{maxPravidel} aktivních)
            </p>
            {pravidla.length === 0 ? (
              <p className="p-3 text-sm text-fg-soft">
                Zatím žádné — vznikne uložením u některého z důvodů přegenerování výše.
              </p>
            ) : (
              pravidla.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                >
                  <div className="flex-1">
                    <p className="text-fg">{p.text}</p>
                    {p.reason ? (
                      <p className="text-xs text-fg-muted">z důvodu „{REGENERATE_REASONS[p.reason].label}“</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.active ? 'secondary' : 'outline'}>{p.active ? 'Aktivní' : 'Vypnuté'}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => void prepnoutPravidlo(p.id, !p.active)}>
                      {p.active ? 'Vypnout' : 'Zapnout'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
