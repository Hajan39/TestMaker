CREATE TABLE `prompt_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`text` text NOT NULL,
	`reason` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `prompt_rules_school_idx` ON `prompt_rules` (`school_id`,`active`);