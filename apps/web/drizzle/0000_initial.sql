CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`params` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`produced_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_jobs_status_idx` ON `generation_jobs` (`status`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_subject_name_idx` ON `grades` (`subject_id`,`name`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_hash_idx` ON `materials` (`content_hash`);--> statement-breakpoint
CREATE INDEX `materials_topic_idx` ON `materials` (`topic_id`);--> statement-breakpoint
CREATE INDEX `materials_duplicate_idx` ON `materials` (`duplicate_of_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text,
	`material_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`points` real DEFAULT 1 NOT NULL,
	`difficulty` integer DEFAULT 2 NOT NULL,
	`explanation` text,
	`source` text DEFAULT 'ai' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `questions_topic_idx` ON `questions` (`topic_id`);--> statement-breakpoint
CREATE INDEX `questions_material_idx` ON `questions` (`material_id`);--> statement-breakpoint
CREATE INDEX `questions_status_idx` ON `questions` (`status`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_name_idx` ON `subjects` (`name`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`config` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_slug_idx` ON `templates` (`slug`);--> statement-breakpoint
CREATE TABLE `test_items` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`question_id` text,
	`text` text,
	`points_override` real,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_items_test_idx` ON `test_items` (`test_id`,`position`);--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`graded` integer DEFAULT true NOT NULL,
	`template_id` text NOT NULL,
	`header` text NOT NULL,
	`variants` integer DEFAULT 1 NOT NULL,
	`show_key` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`grade_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_grade_name_idx` ON `topics` (`grade_id`,`name`);