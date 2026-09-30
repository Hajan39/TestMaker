CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`user_id` text,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`outcome` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_calls_created_idx` ON `ai_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_school_idx` ON `ai_calls` (`school_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `test_items` ADD `content` text;--> statement-breakpoint
ALTER TABLE `test_items` ADD `needs_check` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tests` ADD `kind` text DEFAULT 'pisemka' NOT NULL;--> statement-breakpoint
ALTER TABLE `tests` ADD `topic_id` text REFERENCES topics(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tests` ADD `brief` text;