import { existsSync, readFileSync } from 'node:fs'

/** Only Next.js reads `.env.local`; a script run via tsx has to load it itself. */
export function loadEnv(): void {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}
