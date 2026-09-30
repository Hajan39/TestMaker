ALTER TABLE `users` ADD `active_school_id` text REFERENCES schools(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `schools_google_domain_idx` ON `schools` (`google_domain`);