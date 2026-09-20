CREATE TABLE `puzzle_word_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	`topic_id` text NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
	`kind` text NOT NULL,
	`entries` text NOT NULL,
	`model` text,
	`updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `puzzle_word_drafts_owner_topic_kind_idx`
ON `puzzle_word_drafts` (`school_id`, `owner_id`, `topic_id`, `kind`);
