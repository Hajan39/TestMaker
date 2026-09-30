DROP INDEX `materials_hash_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `materials_topic_hash_idx` ON `materials` (`topic_id`,`content_hash`);