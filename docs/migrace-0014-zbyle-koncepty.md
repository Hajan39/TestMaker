# Migrace 0014 — zbylé koncepty na schválené

Soubor: `apps/web/drizzle-historie/0014_approve-remaining-drafts.sql`

## Co dělá

Otázky ve stavu `draft` (koncept), které v databázi zůstaly, překlopí na
`approved` (schváleno). Schvalování konceptů zmizelo úplně — generování
i import z Claude Code teď ukládají otázky rovnou jako `approved` — takže
fronta ke kontrole (`/review`) mizí spolu s ním a starší koncepty by v ní
zůstaly navždy neviditelné, kdyby je nikdo nepřeklopil.

Migrace nejdřív založí vlastní pomocnou tabulku `migration_0014_approved_drafts`
a poznamená si do ní id všech dotčených otázek, teprve pak jim změní stav.
Bez toho by se po překlopení nedalo poznat, které otázky schválila migrace
a které učitelka sama — a návrat zpět by shodil i její práci. Je to jiná
tabulka než `migration_0006_approved_drafts` z migrace 0006: ta patří
jinému běhu a smísit je do jedné evidence by znemožnilo vrátit zpět jen
tenhle.

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
řádků má `migration_0014_approved_drafts`. Nad databází bez konceptů migrace
proběhne bez chyby a nezmění nic — tabulka zůstane prázdná.

## Návrat zpět

Migrace je vratná. Nad toutéž databází:

```sql
UPDATE questions SET status = 'draft'
 WHERE status = 'approved'
   AND id IN (SELECT question_id FROM migration_0014_approved_drafts);

DROP TABLE migration_0014_approved_drafts;

DELETE FROM __drizzle_migrations WHERE hash = '<hash tohoto souboru>';
```

Tři kroky, každý má svůj důvod:

1. Podmínka `status = 'approved'` vrací jen to, co je pořád ve stavu, do
   kterého to migrace dala. Otázku, kterou učitelka mezitím zamítla, návrat
   nechá zamítnutou — vrací se dopad migrace, ne pozdější rozhodnutí.
2. Pomocná tabulka po návratu nemá co evidovat, takže mizí spolu s ním.
3. Poslední příkaz smaže záznam o migraci z evidence drizzle. Bez něj by
   migrace platila za hotovou a `pnpm db:migrate` by ji už nikdy nespustil.
   Drizzle ale migrátor `libsql` porovnává jen proti nejnovějšímu `created_at`
   v `__drizzle_migrations` — smazání záznamu 0014 tedy způsobí její nové
   spuštění při příštím `pnpm db:migrate` jen tehdy, když je pořád tou
   nejnověji provedenou migrací. Přibyla-li mezitím další migrace (0015 a
   výš), smazání záznamu 0014 nic neopakuje — musela by se smazat i ona,
   jinak migrátor porovnává proti jejímu `created_at` a 0014 už za novější
   nepovažuje. Nad ostrou (nasazenou) Turso databází navíc `pnpm db:migrate`
   musí běžet s `DATABASE_URL` mířícím právě na ni, jinak se návrat provede
   jen nad lokální `local.db` a ostrá databáze zůstane beze změny.

Na rozdíl od migrace 0006 tady nejde smazat poslední záznam podle
`ORDER BY created_at DESC LIMIT 1` — 0014 nemusí být poslední provedená
migrace, kdyby po ní přibyla další. Řádek se dohledá podle hashe souboru
migrace (drizzle ho počítá jako sha256 celého obsahu souboru migrace,
viz `node_modules/drizzle-orm/migrator.js`):

```sql
SELECT hash, created_at FROM __drizzle_migrations;
```

Hash spočítáš třeba takhle:

```bash
shasum -a 256 apps/web/drizzle-historie/0014_approve-remaining-drafts.sql
```

a najdeš řádek s odpovídajícím `hash`.
