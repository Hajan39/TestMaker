-- Indexy pro dotazy, které banka dělá pořád dokola.
--
-- `questions_topic_status_idx` nahrazuje dosavadní index jen podle tématu:
-- otázky se skoro vždycky berou po tématu a zúžené stavem (koncepty ke
-- kontrole, doplňování počtu). Původní index je jeho předponou, takže se
-- ruší — dvakrát totéž by jen zdržovalo zápis.
--
-- `questions_created_idx` drží pořadí (`created_at`, `id`), podle kterého se
-- řadí seznamy i stránkuje kurzorem.
--
-- `generation_jobs_topic_status_idx`: rezervace tématu a zařazování do fronty
-- se ptají na dvojici tématu a stavu. Hotových úloh přibývá donekonečna, index
-- jen podle stavu proto přestává stačit.
--
-- `materials_content_hash_idx`: import hledá materiál podle samotného obsahu
-- napříč tématy, na což složený index začínající tématem použít nejde.
--
-- `test_items_question_idx`: cizí klíč se `set null`, takže každé smazání
-- otázky bez indexu projde celou tabulku položek testů i se snímky otázek.

DROP INDEX `questions_topic_idx`;--> statement-breakpoint
CREATE INDEX `questions_topic_status_idx` ON `questions` (`topic_id`,`status`);--> statement-breakpoint
CREATE INDEX `questions_created_idx` ON `questions` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `generation_jobs_topic_status_idx` ON `generation_jobs` (`topic_id`,`status`);--> statement-breakpoint
CREATE INDEX `materials_content_hash_idx` ON `materials` (`content_hash`);--> statement-breakpoint
CREATE INDEX `test_items_question_idx` ON `test_items` (`question_id`);
