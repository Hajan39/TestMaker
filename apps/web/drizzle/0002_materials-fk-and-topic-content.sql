ALTER TABLE `topics` ADD `usable_char_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `topics` ADD `low_content` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `materials` ALTER COLUMN "duplicate_of_id" TO "duplicate_of_id" text REFERENCES materials(id) ON DELETE set null ON UPDATE no action;