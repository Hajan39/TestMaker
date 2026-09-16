/**
 * Skupina tras pro nepřihlášenou uživatelku. Stránky v ní nemají navigaci
 * aplikace: kdo není přihlášený, stejně nikam z nabídky neproklikne, a plná
 * lišta jen budí dojem, že je uvnitř.
 *
 * Navigaci kolem zbytku aplikace obaluje `AppChrome` v kořenovém rozvržení,
 * které tuhle skupinu vynechává.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-surface-muted px-4 py-16">{children}</main>
}
