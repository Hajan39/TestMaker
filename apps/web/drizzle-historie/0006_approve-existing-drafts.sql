-- Datová migrace: hromadné schválení konceptů, které vznikly dávkovým generováním.
--
-- Majitel rozhodl, že 1042 konceptů se překlopí naráz na schválené a špatné
-- otázky se budou zamítat za pochodu. Migraci nevygeneruje drizzle-kit — mění
-- data, ne schéma — takže je psaná ručně, včetně zápisu v `meta/_journal.json`.
--
-- Nejdřív se dotčená id poznamenají do pomocné tabulky, teprve pak se stav mění.
-- Bez toho by po překlopení nešlo odlišit otázku schválenou migrací od otázky,
-- kterou učitelka schválila sama, a návrat zpět by schválil… tedy zrušil i její práci.
--
-- ------------------------------------------------------------------ NÁVRAT ZPĚT
-- Spustit nad toutéž databází (postup je i v `docs/migrace-0006-schvaleni-konceptu.md`):
--
--   UPDATE questions SET status = 'draft'
--    WHERE status = 'approved'
--      AND id IN (SELECT question_id FROM migration_0006_approved_drafts);
--
--   DROP TABLE migration_0006_approved_drafts;
--
--   DELETE FROM __drizzle_migrations WHERE hash IN (
--     SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1
--   );
--
-- Podmínka `status = 'approved'` je schválně: otázky, které učitelka mezitím
-- zamítla nebo upravila do jiného stavu, návrat nechá být — vracet se má jen to,
-- co migrace opravdu udělala, ne pozdější rozhodnutí.
-- Poslední příkaz smaže záznam o této migraci z evidence drizzle, takže se
-- `pnpm db:migrate` spustí znovu. Bez něj by migrace zůstala „hotová“ a už nikdy
-- neproběhla.

CREATE TABLE `migration_0006_approved_drafts` (
	`question_id` text PRIMARY KEY NOT NULL,
	`approved_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `migration_0006_approved_drafts` (`question_id`)
SELECT `id` FROM `questions` WHERE `status` = 'draft';
--> statement-breakpoint
UPDATE `questions` SET `status` = 'approved'
WHERE `status` = 'draft'
  AND `id` IN (SELECT `question_id` FROM `migration_0006_approved_drafts`);
