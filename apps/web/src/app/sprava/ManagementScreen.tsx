'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { resources, t } from '@testmaker/core/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  BusyButton,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { SchoolForm, type SchoolSettings } from '@/components/SchoolForm'
import type { SchoolDetails } from '@/lib/schoolDetails'
import type { AiQuality } from '@/lib/aiQuality'
import type { PromptRule } from '@/lib/promptRules'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { useUrlTab } from '@/lib/urlTab'
import { MANAGEMENT_TABS, type ManagementTab } from '@/lib/tabs'
import { ASSIGNABLE_ROLES, isAdministratorRole, type Role, type UserStatus } from '@/lib/role'
import { dayjs, formatDateTime } from '@testmaker/core/dates'

export interface AccountRow {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  hasPassword: boolean
  hasGoogle: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
}

export interface EventRow {
  id: string
  at: string
  action: string
  entity: string | null
  entityId: string | null
  detail: unknown
  severity: 'info' | 'chyba'
  who: string | null
}

const adminTexts = resources.cs.admin
type EventCode = keyof typeof adminTexts.events
type DetailField = keyof typeof adminTexts.eventDetail.fields

/** Date and time as read in Czech. */
function when(value: string | null): string {
  if (!value) return '—'
  return dayjs(value).isValid() ? formatDateTime(value) : value
}

/** The event was written by an administrator from outside — `writeAudit` flagged it. */
function fromAdministrator(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && (detail as { administrator?: unknown }).administrator === true
}

/** Label for an event code from `writeAudit`. An unknown code is shown as is. */
function eventLabel(action: string): string {
  return action in adminTexts.events ? t(`admin:events.${action as EventCode}`) : action
}

/** Technical detail of a failed generation (`reportAiFailure`), shown on its own line. */
function technicalOf(detail: unknown): string | null {
  const value = (detail as { technicky?: unknown } | null)?.technicky
  return typeof value === 'string' && value ? value : null
}

/** Event detail as "key: value"; the id, the administrator flag and the technical detail are not listed. */
function describeDetail(detail: unknown): string {
  if (typeof detail !== 'object' || detail === null) return String(detail)
  return Object.entries(detail as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        value !== undefined && value !== null && key !== 'id' && key !== 'administrator' && key !== 'technicky',
    )
    .map(([key, value]) => {
      const text =
        value === true
          ? t('admin:eventDetail.yes')
          : value === false
            ? t('admin:eventDetail.no')
            : key === 'role' && typeof value === 'string' && value in adminTexts.roles
              ? t(`admin:roles.${value as Role}`)
              : key === 'status' && typeof value === 'string' && value in adminTexts.statuses
                ? t(`admin:statuses.${value as UserStatus}`)
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)
      const label =
        key in adminTexts.eventDetail.fields ? t(`admin:eventDetail.fields.${key as DetailField}`) : key
      return `${label}: ${text}`
    })
    .join(' · ')
}

export function ManagementScreen({
  initialTab = 'ucty',
  me,
  school,
  googleDomain,
  googleAutoJoin,
  schoolDetails,
  users,
  events,
  queue,
  aiQuality,
  aiConfigured,
  aiProblems,
  authModeValue,
  rules,
  maxRules,
}: {
  /** Tab from `?karta=` — a reload returns to the tab that was open. */
  initialTab?: ManagementTab
  me: string
  school: string
  googleDomain: string | null
  googleAutoJoin: boolean
  schoolDetails: SchoolDetails
  users: AccountRow[]
  events: EventRow[]
  queue: { queued: number; running: number; done: number; error: number }
  aiQuality: AiQuality
  aiConfigured: boolean
  /** Why something is missing in the model ladder (`describeAiSetup`) — for the owner. */
  aiProblems: string[]
  authModeValue: 'zapnuto' | 'vypnuto' | 'chybne-nastaveno'
  /** The school's prompt rules — newest first. */
  rules: PromptRule[]
  /** The maximum number of active rules (`MAX_ACTIVE_PROMPT_RULES`). */
  maxRules: number
}) {
  const router = useRouter()
  const [tab, setTab] = useUrlTab(MANAGEMENT_TABS, initialTab)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('ucitelka')
  const [busy, setBusy] = useState(false)
  /**
   * A generated password is shown once and only here: it is sent nowhere and
   * nobody can find it out again, because the database holds only a hash.
   */
  const [password, setPassword] = useState<{ email: string; password: string } | null>(null)

  // A rule in progress from the "Make it a rule" button — prefilled from the
  // reason's hint, but the manager may edit it before saving.
  const [newRule, setNewRule] = useState<{ reason: RegenerateReason; text: string } | null>(null)
  const [ruleBusy, setRuleBusy] = useState(false)

  async function saveRule() {
    if (!newRule) return
    setRuleBusy(true)
    try {
      await requestJson(
        '/api/prompt-rules',
        jsonBody('POST', { text: newRule.text, reason: newRule.reason }),
        t('admin:management.quality.ruleSaveFailed'),
      )
      toast.success(t('admin:management.quality.ruleSaved'))
      setNewRule(null)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('admin:management.quality.ruleSaveFailed')))
    } finally {
      setRuleBusy(false)
    }
  }

  /** The rule being toggled right now — a double click would flip it back. */
  const [togglingRule, setTogglingRule] = useState<string | null>(null)

  async function toggleRule(id: string, active: boolean) {
    setTogglingRule(id)
    try {
      await requestJson('/api/prompt-rules', jsonBody('PATCH', { id, active }), t('admin:errors.changeFailed'))
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.changeFailed')))
    } finally {
      setTogglingRule(null)
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      toast.error(t('admin:management.accounts.nameRequired'))
      return
    }
    setBusy(true)
    try {
      const data = await requestJson<{ password: string }>(
        '/api/sprava/uzivatele',
        jsonBody('POST', { email: email.trim(), name: name.trim(), role }),
        t('admin:management.accounts.createFailed'),
      )
      setPassword({ email: email.trim(), password: data.password ?? '' })
      setEmail('')
      setName('')
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('admin:management.accounts.createFailed')))
    } finally {
      setBusy(false)
    }
  }

  async function saveSchool(settings: SchoolSettings): Promise<boolean> {
    try {
      await requestJson('/api/sprava/skola', jsonBody('PATCH', settings), t('admin:errors.schoolSaveFailed'))
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.schoolSaveFailed')))
      return false
    }
    toast.success(t('admin:schools.saved'))
    router.refresh()
    return true
  }

  /** The account a change is running on — its buttons stay disabled until then. */
  const [working, setWorking] = useState<string | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const shownEvents = onlyErrors ? events.filter((event) => event.severity === 'chyba') : events
  /** A change that signs the teacher out — waits for confirmation. */
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    confirmLabel: string
    run: () => Promise<void>
  } | null>(null)

  async function update(id: string, changes: Record<string, unknown>, message: string) {
    setWorking(id)
    try {
      const data = await requestJson<{ password: string }>(
        '/api/sprava/uzivatele',
        jsonBody('PATCH', { id, ...changes }),
        t('admin:errors.changeFailed'),
      )
      if (data.password) {
        const account = users.find((row) => row.id === id)
        setPassword({ email: account?.email ?? '', password: data.password })
      }
      toast.success(message)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.changeFailed')))
    } finally {
      setWorking(null)
    }
  }

  async function copyPassword(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('admin:management.accounts.passwordCopied'))
    } catch {
      toast.error(t('admin:management.accounts.copyFailed'))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="ui-page-title">{t('admin:management.title', { school })}</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('admin:management.intro')}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="ucty">{t('admin:management.tabs.accounts')}</TabsTrigger>
          <TabsTrigger value="udalosti">{t('admin:management.tabs.events')}</TabsTrigger>
          <TabsTrigger value="provoz">{t('admin:management.tabs.operations')}</TabsTrigger>
          <TabsTrigger value="ai-kvalita">{t('admin:management.tabs.aiQuality')}</TabsTrigger>
        </TabsList>

        <TabsContent value="ucty" className="space-y-4">
          {/* In a dialog, not a card at the top: for an account low in the list the
              card would pop up off screen and the manager would never see the password. */}
          <Dialog open={password !== null} onOpenChange={(open) => (open ? null : setPassword(null))}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('admin:management.accounts.passwordFor', { email: password?.email })}</DialogTitle>
                <DialogDescription>{t('admin:management.accounts.passwordHint')}</DialogDescription>
              </DialogHeader>
              <code className="ui-numeric block rounded-[var(--radius-inner)] border border-line p-3 text-center text-lg">
                {password?.password}
              </code>
              <DialogFooter>
                <Button variant="outline" onClick={() => password && void copyPassword(password.password)}>
                  {t('actions.copy')}
                </Button>
                <Button onClick={() => setPassword(null)}>{t('actions.done')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog open={confirmation !== null} onOpenChange={(open) => (open ? null : setConfirmation(null))}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
                <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('admin:management.accounts.keep')}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    // The dialog closes right away; the button in the account row then shows progress.
                    void confirmation?.run()
                    setConfirmation(null)
                  }}
                >
                  {confirmation?.confirmLabel}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Card className="p-4">
            <h2 className="font-medium text-fg">{t('admin:management.accounts.school')}</h2>
            <p className="mt-1 mb-3 max-w-3xl text-sm text-fg-soft">{t('admin:management.accounts.schoolHint')}</p>
            <SchoolForm
              initial={{ name: school, googleDomain: googleDomain ?? '', googleAutoJoin, ...schoolDetails }}
              submitLabel={t('admin:management.accounts.saveSchool')}
              onSave={saveSchool}
            />
          </Card>

          <Card className="p-4">
            <h2 className="font-medium text-fg">{t('admin:management.accounts.newAccount')}</h2>
            <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={create}>
              <div className="w-64">
                <Label htmlFor="new-email">{t('admin:management.accounts.email')}</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="w-56">
                <Label htmlFor="new-name">{t('admin:management.accounts.name')}</Label>
                <Input id="new-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="w-40">
                <Label htmlFor="new-role">{t('admin:management.accounts.role')}</Label>
                <Select value={role} onValueChange={(next) => setRole(next as Role)}>
                  <SelectTrigger id="new-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`admin:roles.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <BusyButton
                type="submit"
                busy={busy}
                busyLabel={t('admin:management.accounts.creating')}
                disabled={!email || !name}
              >
                {t('admin:management.accounts.create')}
              </BusyButton>
            </form>
          </Card>

          <div className="space-y-2">
            {users.map((account) => (
              <Card key={account.id} className="flex-row flex-wrap items-center gap-3 p-3">
                <div className="min-w-56 flex-1">
                  <p className="font-medium text-fg">
                    {account.name}
                    {account.id === me ? (
                      <span className="ml-2 text-xs text-fg-muted">{t('admin:management.accounts.you')}</span>
                    ) : null}
                  </p>
                  <p className="text-sm text-fg-soft">{account.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {account.status !== 'aktivni' ? (
                    <Badge variant={account.status === 'ceka' ? 'secondary' : 'destructive'}>
                      {t(`admin:statuses.${account.status}`)}
                    </Badge>
                  ) : null}
                  {account.hasGoogle ? (
                    <Badge variant="secondary">{t('admin:management.accounts.google')}</Badge>
                  ) : null}
                  {account.mustChangePassword ? (
                    <Badge variant="secondary">{t('admin:management.accounts.mustChangePassword')}</Badge>
                  ) : null}
                  <span className="ui-numeric text-xs text-fg-muted">
                    {t('admin:management.accounts.lastLogin', { when: when(account.lastLoginAt) })}
                  </span>
                </div>

                {isAdministratorRole(account.role) ? (
                  // The administrator is managed only by the script at the
                  // database; here it is only shown that they are in the school.
                  <Badge variant="secondary">{t(`admin:roles.${account.role}`)}</Badge>
                ) : (
                  <>
                    {/* The own account cannot be changed here: by demoting themselves or
                        setting a new password the manager would sign out or lock
                        themselves out of management. */}
                    <Select
                      value={account.role}
                      disabled={account.id === me || working === account.id}
                      onValueChange={(next) =>
                        void update(
                          account.id,
                          { role: next },
                          t('admin:management.accounts.roleChanged', { role: t(`admin:roles.${next as Role}`) }),
                        )
                      }
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`admin:roles.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {account.id === me ? (
                      <span className="text-xs text-fg-muted">{t('admin:management.accounts.ownAccount')}</span>
                    ) : (
                      <>
                        <BusyButton
                          size="sm"
                          variant="outline"
                          busy={working === account.id}
                          busyLabel={t('admin:management.accounts.working')}
                          disabled={working !== null}
                          onClick={() =>
                            setConfirmation({
                              title: t('admin:management.accounts.resetTitle', { name: account.name }),
                              description: t('admin:management.accounts.resetDescription'),
                              confirmLabel: t('admin:management.accounts.resetConfirm'),
                              run: () =>
                                update(account.id, { password: true }, t('admin:management.accounts.resetDone')),
                            })
                          }
                        >
                          {t('admin:management.accounts.newPassword')}
                        </BusyButton>
                        {account.status === 'aktivni' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={working !== null}
                            onClick={() =>
                              setConfirmation({
                                title: t('admin:management.accounts.blockTitle', { name: account.name }),
                                description: t('admin:management.accounts.blockDescription'),
                                confirmLabel: t('admin:management.accounts.block'),
                                run: () =>
                                  update(
                                    account.id,
                                    { status: 'zablokovany' },
                                    t('admin:management.accounts.blocked'),
                                  ),
                              })
                            }
                          >
                            {t('admin:management.accounts.block')}
                          </Button>
                        ) : account.status === 'ceka' ? (
                          // A Google account is created with the Preview role; an approved
                          // teacher should work, not just read. Another role (Manager)
                          // could be chosen beforehand; whoever should keep only Preview
                          // gets switched after approval.
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={working !== null}
                            onClick={() => {
                              const newRole: Role = account.role === 'nahled' ? 'ucitelka' : account.role
                              void update(
                                account.id,
                                { status: 'aktivni', role: newRole },
                                t('admin:management.accounts.approved', { role: t(`admin:roles.${newRole}`) }),
                              )
                            }}
                          >
                            {t('admin:management.accounts.approve')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={working !== null}
                            onClick={() =>
                              void update(account.id, { status: 'aktivni' }, t('admin:management.accounts.unblocked'))
                            }
                          >
                            {t('admin:management.accounts.unblock')}
                          </Button>
                        )}
                      </>
                    )}
                  </>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="udalosti" className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyErrors} onCheckedChange={(checked) => setOnlyErrors(checked === true)} />
            {t('admin:management.events.onlyErrors')}
          </label>
          <Card className="divide-y divide-line">
            {shownEvents.length === 0 ? (
              <p className="p-4 text-sm text-fg-soft">
                {onlyErrors ? t('admin:management.events.noErrors') : t('admin:management.events.empty')}
              </p>
            ) : (
              shownEvents.map((event) => (
                <div key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 text-sm">
                  <span className="ui-numeric w-40 shrink-0 text-xs text-fg-muted">{when(event.at)}</span>
                  <span
                    className={
                      event.severity === 'chyba' ? 'font-medium text-danger' : 'font-medium text-fg'
                    }
                  >
                    {eventLabel(event.action)}
                  </span>
                  <span className="text-fg-soft">{event.who ?? t('admin:management.events.anonymous')}</span>
                  {fromAdministrator(event.detail) ? (
                    <Badge variant="secondary">{t('admin:management.events.administrator')}</Badge>
                  ) : null}
                  {event.detail && describeDetail(event.detail) ? (
                    <span className="text-xs text-fg-muted">{describeDetail(event.detail)}</span>
                  ) : null}
                  {technicalOf(event.detail) ? (
                    // What the model or the server actually answered — for the manager, not the teacher.
                    <code className="block w-full whitespace-pre-wrap break-words rounded-[var(--radius-inner)] bg-surface-muted px-2 py-1 text-xs text-fg-soft">
                      {technicalOf(event.detail)}
                    </code>
                  ) : null}
                </div>
              ))
            )}
          </Card>
        </TabsContent>

        <TabsContent value="provoz" className="space-y-3">
          <Card className="space-y-1 p-4 text-sm">
            <p>{t('admin:management.operations.queue', queue)}</p>
            <p>
              {aiConfigured
                ? t('admin:management.operations.aiConfigured')
                : t('admin:management.operations.aiNotConfigured')}
            </p>
            {aiProblems.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-soft">
                {aiProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <p>
              {t(`admin:authModes.${authModeValue}`)}
              {googleDomain
                ? t('admin:management.operations.googleDomain', { domain: googleDomain })
                : t('admin:management.operations.noGoogle')}
              .
            </p>
          </Card>
          <Card className="p-4 text-sm">
            <p className="text-fg-soft">{t('admin:management.operations.backupHint')}</p>
            <Button className="mt-2" variant="outline" size="sm" asChild>
              <a href="/zaloha">{t('admin:management.operations.openBackup')}</a>
            </Button>
          </Card>
        </TabsContent>

        <TabsContent value="ai-kvalita" className="space-y-4">
          <p className="max-w-3xl text-sm text-fg-soft">{t('admin:management.quality.intro')}</p>

          {aiQuality.models.length === 0 ? (
            <Card className="p-4 text-sm text-fg-soft">{t('admin:management.quality.empty')}</Card>
          ) : (
            <>
              <Card className="divide-y divide-line">
                <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  {t('admin:management.quality.models')}
                </p>
                {aiQuality.models.map((model) => {
                  // Without a generated question in the window the share cannot be
                  // computed — "—", not division by zero. Capped at 100 %: both numbers
                  // have their own ninety-day window (see the comment in aiQuality.ts),
                  // so regenerated can technically exceed generated.
                  const share =
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
                        {t('admin:management.quality.modelStats', {
                          generated: model.generated,
                          regenerated: model.regenerated,
                          share,
                        })}
                      </span>
                    </div>
                  )
                })}
              </Card>

              {aiQuality.reasons.length > 0 ? (
                <Card className="divide-y divide-line">
                  <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                    {t('admin:management.quality.topReasons')}
                  </p>
                  {aiQuality.reasons.map((row) => (
                    <div
                      key={row.reason ?? 'no-reason'}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                    >
                      <span className="text-fg">
                        {row.reason ? REGENERATE_REASONS[row.reason].label : t('admin:management.quality.noReason')}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="ui-numeric text-fg-soft">{row.count}×</span>
                        {row.reason ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setNewRule({ reason: row.reason!, text: REGENERATE_REASONS[row.reason!].rule })
                            }
                          >
                            {t('admin:management.quality.makeRule')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </Card>
              ) : null}

              {newRule ? (
                <Card className="space-y-2 p-4">
                  <h3 className="font-medium text-fg">
                    {t('admin:management.quality.newRuleTitle', { reason: REGENERATE_REASONS[newRule.reason].label })}
                  </h3>
                  <p className="text-sm text-fg-soft">{t('admin:management.quality.newRuleHint')}</p>
                  <Textarea
                    value={newRule.text}
                    maxLength={300}
                    onChange={(event) => setNewRule({ ...newRule, text: event.target.value })}
                  />
                  <div className="flex gap-2">
                    <BusyButton
                      busy={ruleBusy}
                      busyLabel={t('actions.saving')}
                      disabled={!newRule.text.trim()}
                      onClick={() => void saveRule()}
                    >
                      {t('admin:management.quality.saveRule')}
                    </BusyButton>
                    <Button variant="ghost" onClick={() => setNewRule(null)}>
                      {t('actions.cancel')}
                    </Button>
                  </div>
                </Card>
              ) : null}

              {aiQuality.bySubject.length > 0 ? (
                <Card className="divide-y divide-line">
                  <p className="p-3 text-xs font-medium uppercase tracking-wide text-fg-muted">
                    {t('admin:management.quality.bySubject')}
                  </p>
                  {aiQuality.bySubject.map((row) => (
                    <div
                      key={row.subject}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                    >
                      <span className="text-fg">{row.subject}</span>
                      <span className="ui-numeric text-fg-soft">
                        {row.regenerated}×
                        {row.topReason
                          ? t('admin:management.quality.topReason', {
                              reason: REGENERATE_REASONS[row.topReason].label.toLowerCase(),
                            })
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
              {t('admin:management.quality.rules', { active: rules.filter((p) => p.active).length, max: maxRules })}
            </p>
            {rules.length === 0 ? (
              <p className="p-3 text-sm text-fg-soft">{t('admin:management.quality.noRules')}</p>
            ) : (
              rules.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3 text-sm"
                >
                  <div className="flex-1">
                    <p className="text-fg">{p.text}</p>
                    {p.reason ? (
                      <p className="text-xs text-fg-muted">
                        {t('admin:management.quality.fromReason', { reason: REGENERATE_REASONS[p.reason].label })}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={p.active ? 'secondary' : 'outline'}>
                      {p.active ? t('admin:management.quality.active') : t('admin:management.quality.inactive')}
                    </Badge>
                    <BusyButton
                      size="sm"
                      variant="ghost"
                      busy={togglingRule === p.id}
                      busyLabel={
                        p.active ? t('admin:management.quality.disabling') : t('admin:management.quality.enabling')
                      }
                      disabled={togglingRule !== null}
                      onClick={() => void toggleRule(p.id, !p.active)}
                    >
                      {p.active ? t('admin:management.quality.disable') : t('admin:management.quality.enable')}
                    </BusyButton>
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
