/**
 * Return after sign-in — only a path inside the app, never a foreign address.
 * Dependency-free so the browser form can use it too. Browsers read a
 * backslash as `/`, so `/\cizi.cz` would lead out just like `//cizi.cz`.
 */
export function safeReturnPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  return next
}
