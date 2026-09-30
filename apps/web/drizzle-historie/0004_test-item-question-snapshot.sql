PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_test_items` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`question_id` text,
	`text` text,
	`points_override` real,
	`lines_override` integer,
	`question_snapshot` text,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_test_items`("id", "test_id", "position", "kind", "question_id", "text", "points_override", "lines_override", "question_snapshot") SELECT "id", "test_id", "position", "kind", "question_id", "text", "points_override", "lines_override", NULL FROM `test_items`;--> statement-breakpoint
DROP TABLE `test_items`;--> statement-breakpoint
ALTER TABLE `__new_test_items` RENAME TO `test_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `test_items_test_idx` ON `test_items` (`test_id`,`position`);