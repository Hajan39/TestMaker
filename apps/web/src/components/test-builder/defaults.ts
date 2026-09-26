import type { TestHeaderConfig } from '@testmaker/core/schema'

/**
 * Prázdná hlavička nové písemky — dřív se psala jako inline literál na dvou
 * místech (`TestBuilder`, výběr otázek z tématu) a hrozilo, že se rozejdou.
 */
export function emptyHeader(): TestHeaderConfig {
  return { school: '', subject: '', className: '', teacher: '', date: '', note: '' }
}

/**
 * Výchozí šablona nové písemky — první podle pořadí, jak ho vrací
 * `loadTemplates` (`position`, pak název). Prázdný seznam šablon nemá vrátit
 * nic, na co by šlo omylem uložit test.
 */
export function defaultTemplateId(templates: { id: string }[]): string {
  return templates[0]?.id ?? ''
}
