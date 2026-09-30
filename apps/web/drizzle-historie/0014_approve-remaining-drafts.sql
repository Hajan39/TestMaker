-- Datová migrace: zbylé koncepty na schválené.
--
-- Schvalování konceptů zmizelo (viz `0006_approve-existing-drafts.sql`) —
-- generování teď ukládá otázky rovnou jako `approved`. Ve starších tématech
-- ale zůstaly řádky ve stavu `draft` z doby, než tahle migrace proběhla, a ty
-- fronta ke kontrole (`/review`) nikdy neukáže, protože fronta mizí spolu
-- s tímhle plánem. Migrace je dorovná na `approved`, ať nezůstanou navždy
-- neviditelné.
--
-- Postup je tentýž jako u 0006: nejdřív se dotčená id poznamenají do vlastní
-- pomocné tabulky (ne do `migration_0006_approved_drafts` — ta patří jiné
-- migraci a smísit dva běhy do jedné evidence by znemožnilo návrat zpět jen
-- pro tenhle), teprve pak se stav mění.
--
-- ------------------------------------------------------------------ NÁVRAT ZPĚT
-- Spustit nad toutéž databází (postup je i v `docs/migrace-0014-zbyle-koncepty.md`):
--
--   UPDATE questions SET status = 'draft'
--    WHERE status = 'approved'
--      AND id IN (SELECT question_id FROM migration_0014_approved_drafts);
--
--   DROP TABLE migration_0014_approved_drafts;
--
-- Poslední krok smaže záznam o téhle migraci z evidence drizzle. Nejde použít
-- `ORDER BY created_at DESC LIMIT 1` jako u 0006 — 0014 nemusí být poslední
-- provedená migrace, kdyby po ní přibyla další. Vybrat je potřeba podle hashe
-- souboru migrace (`SELECT hash, created_at FROM __drizzle_migrations` a najít
-- řádek, jehož hash odpovídá sha256 obsahu tohoto souboru):
--
--   DELETE FROM __drizzle_migrations WHERE hash = '<hash tohoto souboru>';
--
-- Podmínka `status = 'approved'` je schválně: otázky, které učitelka mezitím
-- zamítla, návrat nechá být — vrací se jen to, co migrace opravdu udělala.

CREATE TABLE `migration_0014_approved_drafts` (
	`question_id` text PRIMARY KEY NOT NULL,
	`approved_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `migration_0014_approved_drafts` (`question_id`)
SELECT `id` FROM `questions` WHERE `status` = 'draft';
--> statement-breakpoint
UPDATE `questions` SET `status` = 'approved'
WHERE `status` = 'draft'
  AND `id` IN (SELECT `question_id` FROM `migration_0014_approved_drafts`);
