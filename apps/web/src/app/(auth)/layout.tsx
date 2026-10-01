/**
 * Route group for signed-out users. Its pages have no app navigation: someone
 * not signed in cannot click anywhere from the menu anyway, and a full bar
 * only suggests they are inside.
 *
 * The rest of the app is wrapped in navigation by `AppChrome` in the root
 * layout, which skips this group.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-surface-muted px-4 py-16">{children}</main>
}
