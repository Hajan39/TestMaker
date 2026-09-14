ALTER TABLE `materials` ADD `duplicate_of_id` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `duplicate_score` real;--> statement-breakpoint
CREATE INDEX `materials_duplicate_idx` ON `materials` (`duplicate_of_id`);