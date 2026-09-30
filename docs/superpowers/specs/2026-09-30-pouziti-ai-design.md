# Použití AI v administraci

Datum: 2026-09-30

## Proč

Generování jede přes žebříček modelů (`AI_MODELS`), většinou na bezplatných
tarifech s denními limity. Administrátor dnes nevidí, který model se opravdu
volá, kolik tokenů spotřeboval, jak často narazil na limit a kolikrát odpověděl
nepoužitelně. Záložka „AI kvalita“ ve Správě ukazuje jen kvalitu otázek podle
přegenerování, ne provoz.

## Co platí dál

- Nastavení AI zůstává jen v `AI_MODELS` a klíčích v prostředí; přehled je
  jen ke čtení, nic nenastavuje.
- Volání modelu jde jedině přes `startLadder` / `objectCall`
  v `packages/core/src/ai/ladder.ts`. Core nesmí záviset na databázi.

## Měření v core

`startLadder(models, signal, onCall?)` dostane nepovinný posluchač. Pro každý
**pokus** o volání jednoho modelu (tedy i pro model, kterému došel limit
a žebříček šel dál) zavolá `onCall(event)`:

```ts
interface AiCallEvent {
  model: string            // `poskytovatel:model`
  outcome: 'ok' | 'limit' | 'bad_shape' | 'error'
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
}
```

- `ok`: model odpověděl ve tvaru; tokeny z `usage` výsledku `generateObject`.
- `bad_shape`: model odpověděl, ale ne ve tvaru (`rawTextOf` není `null`).
- `limit`: chyba, kterou `describeAiError` označí jako `retryable`.
- `error`: cokoli jiného (chybný klíč, síť). Přerušení (`AbortError`) se
  neměří.

Tokeny předá `objectCall` žebříčku přes rozhraní, které `ladder.call` dá
funkci volání (druhý argument `meter` s metodou `usage(input, output)`).
Poskytovatel, který usage nevrátí, zapíše `null`.

Posluchač nesmí shodit generování: výjimka z `onCall` se spolkne a zaloguje.
Kdo `onCall` nepředá (skripty, testy), nic se neměří.

Úloha se k události přidá až ve webu (viz níž); core ji nezná.

## Data

Nová tabulka `ai_calls` (bez vazby na zálohy školy, je to provozní záznam):

| Sloupec | Typ | Význam |
|---|---|---|
| `id` | text PK | |
| `school_id` | text, FK `schools.id` `on delete cascade` | škola, v jejímž rozsahu se generovalo |
| `user_id` | text, nepovinný, FK `users.id` `on delete set null` | kdo generování spustil; u fronty/cronu prázdné |
| `task` | text: `otazky` \| `hlavolam` \| `list` | k čemu volání bylo |
| `model` | text | `poskytovatel:model` |
| `outcome` | text: `ok` \| `limit` \| `bad_shape` \| `error` | |
| `input_tokens` | integer, nepovinný | |
| `output_tokens` | integer, nepovinný | |
| `duration_ms` | integer | |
| `created_at` | text | |

Index `(created_at)` a `(school_id, created_at)`.

Záznamy starší než 400 dní smaže zápis nového záznamu občasně (jednou za
~500 zápisů), aby tabulka nerostla donekonečna. `ponytail:` úklid při zápisu,
cron až to bude potřeba.

Do zálohy školy (`lib/backup.ts`) ani do `push-remote.ts` se tabulka
nepřenáší.

## Zápis ve webu

`apps/web/src/lib/aiUsage.ts`:

- `zapisovatVolani(scope | { schoolId, userId }, task)` vrátí `onCall` pro
  `startLadder`; zápis je asynchronní a chyba zápisu generování neshodí,
- zapojení: generování otázek (`lib/generation.ts`, včetně fronty
  a `generate:bulk`), slova do hlavolamu (`lib/puzzles.ts`), generování
  a přegenerování listu (až vznikne; spec pracovních listů).

`generateQuestions` a `generatePuzzleWords` v core dostanou `onCall`
v options a předají ho do `startLadder`.

## Přehled

V `/administrace` (jen administrátor) nová sekce **„Použití AI“** nad
seznamem škol:

- přepínač období: 7 / 30 / 90 dní (výchozí 30),
- **žebříček modelů** tak, jak je teď nastavený (`readAiLadder`), v pořadí
  a u každého, jestli má klíč; bez klíče s poznámkou „přeskakuje se, chybí
  klíč“,
- **tabulka podle modelu** za období: volání celkem, úspěšná, narazila na
  limit, nepoužitelná odpověď, chyba, tokeny vstup/výstup, naposledy použit,
- **podle úlohy**: otázky / hlavolamy / listy, volání a tokeny,
- **podle školy**: volání a tokeny na školu (administrátor vidí napříč
  školami; to je výjimka z jedné školy na dotaz, vědomá a jen tady, dotaz
  vrací jen agregáty, žádný obsah),
- **denní řada** počtu volání za období jako jednoduché sloupce (CSS, bez
  knihovny), barevně rozlišený úspěch a limit.

Ceny se nepočítají: tarify se mění a většina je bezplatná. Kdo chce cenu, vezme
tokeny z tabulky.

Dotaz: `apps/web/src/lib/aiUsage.ts` → `prehledPouzitiAi(scope, dni)`, vrací
`null` pro jinou roli než administrátor (stránka se pak tváří jako neexistující).
API: `GET /api/administrace/ai?dni=30`.

Prázdný stav: „Zatím se nic negenerovalo. Záznamy se sbírají od nasazení
této verze.“

## Testy

- core: `startLadder` s `onCall` hlásí `ok` s tokeny, `limit` a pokračuje dál,
  `bad_shape`, `error`; výjimka z `onCall` generování neshodí; bez `onCall`
  se chová jako dřív,
- web: `prehledPouzitiAi` agreguje správně podle modelu, úlohy, školy a dne
  a vrací `null` mimo roli administrátor; úklid starých záznamů,
- e2e (login běh, `admin@localhost`): sekce se ukáže s daty ze seedu;
  učitelka se na `/api/administrace/ai` dostane k 404,
- `seed-e2e.ts` vloží pár záznamů `ai_calls`.
