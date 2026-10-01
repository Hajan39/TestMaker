import type { Metadata } from 'next'
import { THEME_INIT_SCRIPT, Toaster, TooltipProvider } from '@testmaker/ui'
import { authMode } from '@/lib/session'
import { isAdministratorRole } from '@/lib/role'
import { listSchools } from '@/lib/schools'
import { currentUser } from '@/lib/user'
import { t } from '@testmaker/core/i18n'
import { AppChrome } from './AppChrome'
import './globals.css'

export function generateMetadata(): Metadata {
  return {
    title: t('auth:shell.metaTitle'),
    description: t('auth:shell.metaDescription'),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A name in the bar only makes sense where people really sign in; a local
  // run works under the default account and has nobody to show.
  const user = authMode() === 'zapnuto' ? await currentUser() : null
  // An administrator gets a school switcher in the bar; others don't load the list.
  const schools =
    user && isAdministratorRole(user.role)
      ? ((await listSchools(user)) ?? []).map((school) => ({ id: school.id, name: school.name }))
      : []
  const account = user
    ? {
        name: user.name,
        email: user.email,
        role: user.role,
        school: { id: user.schoolId, name: user.schoolName },
        homeSchoolId: user.homeSchoolId,
        hasPassword: user.hasPassword !== false,
        schools,
      }
    : null

  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        {/* The theme is set before rendering, otherwise dark mode flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">
        <TooltipProvider delayDuration={300}>
          <AppChrome account={account}>{children}</AppChrome>
        </TooltipProvider>
        {/*
          Toasts sit bottom right: the bar is at the top, navigation on the
          left and dialogs open in the middle — the bottom right corner covers
          nothing. Colours come from tokens, so dark mode recolours them.
        */}
        <Toaster position="bottom-right" />
      </body>
    </html>
  )
}
