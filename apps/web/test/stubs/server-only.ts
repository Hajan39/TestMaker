/**
 * Replacement for the `server-only` package in tests. It exists only so the
 * Next.js bundler forbids importing a server module into the browser; outside
 * the bundler it cannot be loaded, so vitest replaces it with this empty module.
 */
export {}
