import i18next from 'i18next'
import admin from './locales/cs/admin.json'
import ai from './locales/cs/ai.json'
import api from './locales/cs/api.json'
import auth from './locales/cs/auth.json'
import backup from './locales/cs/backup.json'
import common from './locales/cs/common.json'
import core from './locales/cs/core.json'
import generation from './locales/cs/generation.json'
import library from './locales/cs/library.json'
import pdf from './locales/cs/pdf.json'
import puzzles from './locales/cs/puzzles.json'
import tests from './locales/cs/tests.json'
import ui from './locales/cs/ui.json'
import worksheets from './locales/cs/worksheets.json'

/**
 * Every user-facing text of the app (web UI, API errors, core errors, PDF
 * labels) lives in `locales/<lng>/<namespace>.json`. Prompts for the model are
 * not UI texts and stay in `ai/prompts`.
 *
 * Czech is the only language for now, so a single synchronously initialised
 * instance is shared by server, client, core and ui — `t()` works anywhere
 * without a provider. Call `t()` where the text is used, never in a
 * module-level constant, so a later language switch takes effect.
 *
 * Adding a language means adding `locales/<lng>` and choosing the language
 * per request (server) and per user (client, then via react-i18next).
 */
export const resources = {
  cs: { admin, ai, api, auth, backup, common, core, generation, library, pdf, puzzles, tests, ui, worksheets },
} as const

export const defaultNS = 'common'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
    resources: (typeof resources)['cs']
    returnNull: false
  }
}

export const i18n = i18next.createInstance()

void i18n.init({
  lng: 'cs',
  fallbackLng: 'cs',
  resources,
  defaultNS,
  ns: Object.keys(resources.cs),
  initAsync: false,
  returnNull: false,
  // React escapes on render; PDF and toasts need the raw text.
  interpolation: { escapeValue: false },
})

export const t = i18n.t.bind(i18n)
