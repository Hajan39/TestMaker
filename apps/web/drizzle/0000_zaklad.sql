CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`school_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`detail` text,
	`severity` text DEFAULT 'info' NOT NULL,
	`ip` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_school_at_idx` ON `audit_log` (`school_id`,`at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_log` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`topic_id` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`produced_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_school_status_idx` ON `generation_jobs` (`school_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_requester_status_idx` ON `generation_jobs` (`requested_by`,`status`);--> statement-breakpoint
CREATE INDEX `generation_jobs_topic_status_idx` ON `generation_jobs` (`topic_id`,`status`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`created_by` text,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_subject_name_idx` ON `grades` (`subject_id`,`name`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`created_by` text,
	`topic_id` text NOT NULL,
	`file_name` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`page_count` integer,
	`needs_ocr` integer DEFAULT false NOT NULL,
	`content_hash` text NOT NULL,
	`duplicate_of_id` text,
	`duplicate_score` real,
	`excluded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_topic_hash_idx` ON `materials` (`topic_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `materials_topic_idx` ON `materials` (`topic_id`);--> statement-breakpoint
CREATE INDEX `materials_duplicate_idx` ON `materials` (`duplicate_of_id`);--> statement-breakpoint
CREATE INDEX `materials_school_hash_idx` ON `materials` (`school_id`,`content_hash`);--> statement-breakpoint
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
CREATE INDEX `prompt_rules_school_idx` ON `prompt_rules` (`school_id`,`active`);--> statement-breakpoint
CREATE TABLE `puzzle_word_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`kind` text NOT NULL,
	`entries` text NOT NULL,
	`model` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `puzzle_word_drafts_owner_topic_kind_idx` ON `puzzle_word_drafts` (`school_id`,`owner_id`,`topic_id`,`kind`);--> statement-breakpoint
CREATE TABLE `puzzles` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`topic_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`entries` text NOT NULL,
	`payload` text NOT NULL,
	`model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `puzzles_topic_idx` ON `puzzles` (`topic_id`);--> statement-breakpoint
CREATE INDEX `puzzles_owner_idx` ON `puzzles` (`school_id`,`owner_id`,`updated_at`);--> statement-breakpoint
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
CREATE INDEX `question_feedback_school_idx` ON `question_feedback` (`school_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`created_by` text,
	`reviewed_by` text,
	`reviewed_at` text,
	`topic_id` text,
	`material_id` text,
	`variant_of` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`points` real DEFAULT 1 NOT NULL,
	`difficulty` integer DEFAULT 2 NOT NULL,
	`explanation` text,
	`source` text DEFAULT 'ai' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`source_file` text,
	`source_quote` text,
	`model` text,
	`search_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_of`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_topic_status_idx` ON `questions` (`topic_id`,`status`);--> statement-breakpoint
CREATE INDEX `questions_material_idx` ON `questions` (`material_id`);--> statement-breakpoint
CREATE INDEX `questions_variant_of_idx` ON `questions` (`variant_of`);--> statement-breakpoint
CREATE INDEX `questions_school_status_idx` ON `questions` (`school_id`,`status`);--> statement-breakpoint
CREATE INDEX `questions_school_created_by_idx` ON `questions` (`school_id`,`created_by`);--> statement-breakpoint
CREATE INDEX `questions_school_created_idx` ON `questions` (`school_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `schools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`google_domain` text,
	`google_auto_join` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schools_slug_idx` ON `schools` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `schools_google_domain_idx` ON `schools` (`google_domain`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ip` text,
	`user_agent` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`created_by` text,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_school_name_idx` ON `subjects` (`school_id`,`name`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`config` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_school_slug_idx` ON `templates` (`school_id`,`slug`);--> statement-breakpoint
CREATE TABLE `test_items` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`test_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`question_id` text,
	`text` text,
	`points_override` real,
	`lines_override` integer,
	`question_snapshot` text,
	`puzzle_id` text,
	`puzzle_snapshot` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`puzzle_id`) REFERENCES `puzzles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `test_items_test_idx` ON `test_items` (`test_id`,`position`);--> statement-breakpoint
CREATE INDEX `test_items_question_idx` ON `test_items` (`question_id`);--> statement-breakpoint
CREATE INDEX `test_items_puzzle_idx` ON `test_items` (`puzzle_id`);--> statement-breakpoint
CREATE INDEX `test_items_school_idx` ON `test_items` (`school_id`);--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'soukrome' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`graded` integer DEFAULT true NOT NULL,
	`template_id` text NOT NULL,
	`grade_id` text,
	`header` text NOT NULL,
	`variants` integer DEFAULT 1 NOT NULL,
	`show_key` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tests_owner_idx` ON `tests` (`school_id`,`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`created_by` text,
	`grade_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`usable_char_count` integer DEFAULT 0 NOT NULL,
	`low_content` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_grade_name_idx` ON `topics` (`grade_id`,`name`);--> statement-breakpoint
CREATE INDEX `topics_school_idx` ON `topics` (`school_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'ucitelka' NOT NULL,
	`password_hash` text,
	`google_sub` text,
	`status` text DEFAULT 'aktivni' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_by` text,
	`active_school_id` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`active_school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_idx` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `users_school_status_idx` ON `users` (`school_id`,`status`);