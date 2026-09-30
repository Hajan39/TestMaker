# Migrace 0011 — uživatelé, školy a vlastnictví obsahu

Soubor: `apps/web/drizzle-historie/0011_vlastnictvi.sql`

## Co dělá

Do té doby byla aplikace pro jednu učitelku: přihlašovalo se jedním sdíleným
heslem a žádný záznam v databázi neměl vlastníka. Tahle migrace zavádí školu
a účty a připisuje jim všechen dosavadní obsah.

- Nové tabulky `schools`, `users`, `sessions`, `audit_log`.
- `school_id` dostane jedenáct tabulek s obsahem (`subjects`, `grades`,
  `topics`, `materials`, `assets`, `questions`, `puzzles`, `generation_jobs`,
  `templates`, `tests`, `test_items`).
- `tests.owner_id` a `tests.visibility`, `puzzles.owner_id`,
  `generation_jobs.requested_by` — písemky a hlavolamy jsou soukromé,
  fronta ví, za koho generuje.
- `questions.created_by`, `reviewed_by`, `reviewed_at` a `created_by`
  u ostatních tabulek knihovny. Je to jen evidence; knihovna zůstává společná.
- Unikátní indexy se rozšiřují o školu: `subjects_school_name_idx`,
  `templates_school_slug_idx`. Dvě školy tak mohou mít každá svůj
  „PŘÍRODOPIS".

Všechno existující připadne zakládající škole `skola-zakladatelka`
a zakládajícímu účtu `ucet-zakladatelka`. Ten účet nemá heslo — nastaví ho
skript `pnpm --filter @testmaker/web uzivatel`, který ho zároveň přepíše na
skutečného správce, takže mu dosavadní obsah zůstane.

## Dvě různé cesty, jak přidat sloupec

`school_id` se přidává jako `NOT NULL DEFAULT 'skola-zakladatelka'` a ten
výchozí údaj v tabulce zůstává. SQLite jinak NOT NULL sloupec k neprázdné
tabulce nepřidá a přestavba jedenácti tabulek by byla větší riziko než default,
jehož nejhorší následek je, že by řádek bez uvedené školy spadl do zakládající
— viditelná chyba, ne únik dat mezi školami.

`owner_id` naopak default mít nesmí: u písemky by zapomenutý vlastník znamenal,
že cizí práce tiše připadne někomu jinému. Tabulky `tests`, `puzzles`
a `generation_jobs` proto projdou přestavbou (nová tabulka, přepis řádků,
přejmenování). Mají jednotky až desítky řádků. `PRAGMA defer_foreign_keys=ON`
odloží kontrolu cizích klíčů na konec transakce — `test_items` odkazuje na
`tests` i `puzzles` a bez odkladu by přejmenování neprošlo.

## Jak se pustí

```bash
cd apps/web && pnpm db:migrate     # pozor: nad `local.db` to jsou ostrá data
```

Před spuštěním si udělej kopii souboru (`cp local.db local.db.zaloha`) a po
migraci zkontroluj:

```sql
PRAGMA foreign_key_check;                      -- musí být prázdné
SELECT count(*) FROM subjects WHERE school_id IS NULL;   -- 0
SELECT count(*) FROM tests   WHERE owner_id  IS NULL;    -- 0
SELECT tabulka, pocet FROM migration_0011_vlastnictvi;   -- počty před migrací
```

Tabulka `migration_0011_vlastnictvi` v databázi zůstává. Je to záznam o tom,
co se stalo, a podle ní se pozná, co bylo prvotní přiřazení a co pozdější
práce.

## Návrat zpět

Migrace je vratná, ale ručně a v tomhle pořadí:

1. Zrušit nové indexy a obnovit staré (`subjects_name_idx`,
   `templates_slug_idx`, `materials_content_hash_idx`, `questions_status_idx`,
   `questions_created_idx`, `puzzles_created_idx`,
   `generation_jobs_status_idx`). Sloupec, který je v indexu, nejde zahodit —
   proto jsou indexy první.
2. Přestavět `tests`, `puzzles` a `generation_jobs` bez sloupců vlastníka
   (nová tabulka podle DDL z migrace 0010, přepis řádků, přejmenování).
3. `ALTER TABLE … DROP COLUMN school_id` u zbylých tabulek, totéž
   `created_by`, `reviewed_by`, `reviewed_at`.
4. `DROP TABLE audit_log, sessions, users, schools, migration_0011_vlastnictvi;`
5. Smazat záznam o migraci z evidence, jinak by platila za hotovou:

```sql
DELETE FROM __drizzle_migrations WHERE hash IN (
  SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1
);
```

Návrat zpět vrací data, ne rozhodnutí: účty, které mezitím vznikly, zmizí
i s tím, co vytvořily — proto se před ním dělá záloha stejně jako před
migrací samotnou.
