import { existsSync, readFileSync } from 'node:fs'

/** `.env.local` čte jen Next.js; skript spouštěný přes tsx si ho musí načíst sám. */
export function loadEnv(): void {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}
