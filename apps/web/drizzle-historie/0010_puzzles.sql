-- Hlavolamy: osmisměrka a tajenka.
--
-- Vlastní tabulka `puzzles`, protože hlavolam není otázka — nemá odpověď ani
-- body, negeneruje se do banky a nepatří do kontroly konceptů. Slova
-- a nápovědy leží v `entries`, nastavení (velikost mřížky a seed, nebo tajená
-- věta) v `payload`; samotnou mřížku nikdo neukládá, skládá ji kód v
-- `packages/core/src/puzzle` a ze stejného seedu vyjde vždycky stejná.
--
-- Do písemky se hlavolam zařadí jako pátý druh položky (`test_items.kind =
-- 'puzzle'`). `puzzle_snapshot` drží jeho zmrazenou podobu ze stejného
-- důvodu jako `question_snapshot` u otázky: pozdější úprava hlavolamu nesmí
-- změnit už vytištěnou písemku ani klíč k ní.

CREATE TABLE `puzzles` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`entries` text NOT NULL,
	`payload` text NOT NULL,
	`model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `puzzles_topic_idx` ON `puzzles` (`topic_id`);--> statement-breakpoint
CREATE INDEX `puzzles_created_idx` ON `puzzles` (`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `test_items` ADD `puzzle_id` text REFERENCES puzzles(id);--> statement-breakpoint
ALTER TABLE `test_items` ADD `puzzle_snapshot` text;--> statement-breakpoint
CREATE INDEX `test_items_puzzle_idx` ON `test_items` (`puzzle_id`);
