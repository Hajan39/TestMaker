-- Datová migrace: doplnění vazby otázky na materiál, ze kterého vznikla.
--
-- Otázky z generování se dosud ukládaly jen s tématem — `material_id` zůstávalo
-- prázdné a původ nesl pouze název souboru v `source_file`. Kvůli tomu přesun
-- materiálu do jiného tématu nechával jeho otázky v tom původním. Od teď vazbu
-- plní `insertQuestions`; tady se dopočte pro všechno, co v knihovně už je.
--
-- Páruje se název souboru v rámci téhož tématu. Název, který se v tématu
-- vyskytuje víckrát (tentýž název na jiné cestě), se přeskakuje: přiřadit
-- otázku k jednomu ze dvou stejně pojmenovaných materiálů by byla hádanka
-- a podle špatného tipu by ji pak přesun odnesl do cizího tématu.
--
-- Schéma se nemění, jen data, takže migraci nevygeneruje drizzle-kit — je
-- psaná ručně včetně zápisu v `meta/_journal.json`.
--
-- ------------------------------------------------------------------ NÁVRAT ZPĚT
-- Spustit nad toutéž databází:
--
--   UPDATE questions SET material_id = NULL
--    WHERE id IN (SELECT question_id FROM migration_0012_linked_questions);
--
--   DROP TABLE migration_0012_linked_questions;
--
--   DELETE FROM __drizzle_migrations WHERE hash IN (
--     SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1
--   );
--
-- Poznámka: vrací se jen vazby, které doplnila tahle migrace — soupis v pomocné
-- tabulce je tu právě proto, aby se nesmazaly vazby vzniklé později při
-- generování. Poslední příkaz smaže záznam o migraci z evidence drizzle,
-- takže se `pnpm db:migrate` spustí znovu; bez něj by zůstala „hotová“.

CREATE TABLE `migration_0012_linked_questions` (
	`question_id` text PRIMARY KEY NOT NULL,
	`material_id` text NOT NULL,
	`linked_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `migration_0012_linked_questions` (`question_id`, `material_id`)
SELECT q.`id`, (
	SELECT m.`id` FROM `materials` m
	 WHERE m.`topic_id` = q.`topic_id` AND m.`file_name` = q.`source_file`
)
FROM `questions` q
WHERE q.`material_id` IS NULL
  AND q.`source_file` IS NOT NULL
  AND q.`topic_id` IS NOT NULL
  AND (
	SELECT COUNT(*) FROM `materials` m
	 WHERE m.`topic_id` = q.`topic_id` AND m.`file_name` = q.`source_file`
  ) = 1;
--> statement-breakpoint
UPDATE `questions` SET `material_id` = (
	SELECT l.`material_id` FROM `migration_0012_linked_questions` l WHERE l.`question_id` = `questions`.`id`
)
WHERE `material_id` IS NULL
  AND `id` IN (SELECT `question_id` FROM `migration_0012_linked_questions`);
