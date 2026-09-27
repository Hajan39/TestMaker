ALTER TABLE `questions` ADD `variant_of` text REFERENCES questions(id);--> statement-breakpoint
CREATE INDEX `questions_variant_of_idx` ON `questions` (`variant_of`);