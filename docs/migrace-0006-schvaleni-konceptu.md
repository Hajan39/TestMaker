# Migrace 0006 — hromadné schválení konceptů

Soubor: `apps/web/drizzle-historie/0006_approve-existing-drafts.sql`

## Co dělá

Otázky ve stavu `draft` (koncept) překlopí na `approved` (schváleno). Jde
o jednorázové rozhodnutí: konceptů vzniklých dávkovým generováním je přes
tisíc a procházet je po jednom by trvalo měsíce. Špatné otázky se zamítají
za pochodu, až se na ně přijde.

Migrace nejdřív založí pomocnou tabulku `migration_0006_approved_drafts`
a poznamená si do ní id všech otázek, kterých se to týká, a teprve pak jim
změní stav. Bez toho by se po překlopení nedalo poznat, které otázky schválila
migrace a které učitelka sama — a návrat zpět by shodil i její práci.

Tabulka v databázi zůstává. Je to záznam o tom, co se stalo, a jediná cesta
zpátky; nic ji nemaže automaticky.

## Jak se pustí

```bash
cd apps/web && pnpm db:migrate     # pozor: nad `local.db` to jsou ostrá data
```

Před spuštěním se hodí zkontrolovat počty:

```sql
SELECT status, count(*) FROM questions GROUP BY status;
```

Po migraci má být `draft` na nule a `approved` větší přesně o tolik, kolik
řádků má `migration_0006_approved_drafts`.

## Návrat zpět

Migrace je vratná. Nad toutéž databází:

```sql
UPDATE questions SET status = 'draft'
 WHERE status = 'approved'
   AND id IN (SELECT question_id FROM migration_0006_approved_drafts);

DROP TABLE migration_0006_approved_drafts;

DELETE FROM __drizzle_migrations WHERE hash IN (
  SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1
);
```

Tři kroky, každý má svůj důvod:

1. Podmínka `status = 'approved'` vrací jen to, co je pořád ve stavu, do
   kterého to migrace dala. Otázku, kterou učitelka mezitím zamítla, návrat
   nechá zamítnutou — vrací se dopad migrace, ne pozdější rozhodnutí.
2. Pomocná tabulka po návratu nemá co evidovat, takže mizí spolu s ním.
3. Poslední příkaz smaže záznam o migraci z evidence drizzle. Bez něj by
   migrace platila za hotovou a `pnpm db:migrate` by ji už nikdy nespustil.
   (Je to skutečně poslední záznam v evidenci — 0006 je zatím nejnovější
   migrace. Až nějaká přibude, vybírej podle `created_at` té správné.)
