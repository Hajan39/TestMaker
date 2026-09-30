CREATE TABLE `question_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`question_id` text,
	`replacement_id` text,
	`model` text,
	`reason` text,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`replacement_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `question_feedback_school_idx` ON `question_feedback` (`school_id`,`created_at`);