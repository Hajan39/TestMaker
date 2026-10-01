'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, School } from 'lucide-react'
import { t } from '@testmaker/core/i18n'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'

/**
 * School switcher for the administrator. The school name is always visible in
 * the bar so nobody accidentally works in someone else's school thinking they
 * are at home — hence the badge on a foreign one.
 */
export function SchoolSwitcher({
  school,
  homeSchoolId,
  schools,
}: {
  school: { id: string; name: string }
  homeSchoolId: string
  schools: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const foreign = school.id !== homeSchoolId

  async function switchTo(schoolId: string) {
    if (schoolId === school.id) return
    setBusy(true)
    try {
      await requestJson('/api/administrace/skola', jsonBody('POST', { schoolId }), t('admin:errors.switchFailed'))
      // An open topic or test does not exist in the other school — start from the home page.
      router.push('/')
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('admin:errors.switchFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          aria-label={t('admin:schoolSwitcher.ariaLabel', { name: school.name })}
        >
          <School className="size-4" />
          <span className="max-w-40 truncate">{school.name}</span>
          {foreign ? <Badge variant="secondary">{t('admin:schoolSwitcher.foreign')}</Badge> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-fg-muted">
          {t('admin:schoolSwitcher.workIn')}
        </DropdownMenuLabel>
        {schools.map((option) => (
          <DropdownMenuItem key={option.id} onSelect={() => void switchTo(option.id)}>
            <Check className={option.id === school.id ? 'size-4' : 'size-4 opacity-0'} />
            <span className="truncate">{option.name}</span>
            {option.id === homeSchoolId ? (
              <span className="ml-auto text-xs text-fg-muted">{t('admin:schoolSwitcher.home')}</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/administrace')}>
          {t('admin:schoolSwitcher.adminLink')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
