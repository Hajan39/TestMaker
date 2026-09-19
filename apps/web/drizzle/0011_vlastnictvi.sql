/*
 Migrace 0011 — uživatelé, školy a vlastnictví obsahu.

 Zakládá `schools`, `users`, `sessions` a `audit_log`, doplní `school_id`
 všemu obsahu, `owner_id` písemkám a hlavolamům a `requested_by` frontě.
 Všechen dosavadní obsah připadne zakládající škole 'skola-zakladatelka' a zakládajícímu
 účtu 'ucet-zakladatelka'; skutečný správce ten účet přepíše skriptem
 `pnpm --filter @testmaker/web uzivatel`.

 O heslech ani relacích tahle migrace nerozhoduje — kdyby se vracela zpět,
 nesmí shodit přihlašování.

 Návrat zpět (ručně, nad toutéž databází; podrobně v
 docs/migrace-0011-uzivatele.md):

   1. zrušit nové indexy a obnovit staré
      (`subjects_name_idx`, `templates_slug_idx`, `materials_content_hash_idx`,
      `questions_status_idx`, `questions_created_idx`, `puzzles_created_idx`,
      `generation_jobs_status_idx`),
   2. přestavět `tests`, `puzzles` a `generation_jobs` bez sloupců vlastníka,
   3. `ALTER TABLE ... DROP COLUMN school_id` (a `created_by`, `reviewed_by`,
      `reviewed_at`) — proto se indexy ruší jako první, sloupec v indexu
      zahodit nejde,
   4. `DROP TABLE audit_log, sessions, users, schools, migration_0011_vlastnictvi`,
   5. smazat poslední řádek z `__drizzle_migrations`.
*/
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
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_idx` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `users_school_status_idx` ON `users` (`school_id`,`status`);
--> statement-breakpoint
/*
 Zakládající škola a zakládající účet. Id jsou napsaná natvrdo schválně:
 návrat zpět (v hlavičce nahoře) je pak jednoznačný a všechen dosavadní obsah
 se dá najít podle nich. Heslo se sem nezapisuje — účet zatím žádné nemá
 a nastaví ho skript `scripts/uzivatel.ts`, který tenhle řádek přepíše.
*/
INSERT INTO `schools` (`id`, `name`, `slug`) VALUES ('skola-zakladatelka', 'Základní škola', 'zakladni-skola');--> statement-breakpoint
INSERT INTO `users` (`id`, `school_id`, `email`, `name`, `role`, `status`, `must_change_password`)
VALUES ('ucet-zakladatelka', 'skola-zakladatelka', 'zakladatelka@localhost', 'Zakládající účet', 'spravce', 'aktivni', 1);--> statement-breakpoint

/*
 Záznam o tom, co migrace udělala — obdoba `migration_0006_approved_drafts`.
 Neukládají se id řádků (bylo by jich přes patnáct set), ale počty a použitá
 id: podle nich se po migraci ověří, že nic nezůstalo bez vlastníka, a podle
 nich se pozná, co bylo prvotní přiřazení a co pozdější práce.
*/
CREATE TABLE `migration_0011_vlastnictvi` (
	`tabulka` text NOT NULL,
	`pocet` integer NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`provedeno_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);--> statement-breakpoint
INSERT INTO `migration_0011_vlastnictvi` (`tabulka`, `pocet`, `school_id`, `owner_id`)
SELECT 'subjects', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `subjects`
UNION ALL SELECT 'grades', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `grades`
UNION ALL SELECT 'topics', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `topics`
UNION ALL SELECT 'materials', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `materials`
UNION ALL SELECT 'assets', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `assets`
UNION ALL SELECT 'questions', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `questions`
UNION ALL SELECT 'templates', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `templates`
UNION ALL SELECT 'puzzles', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `puzzles`
UNION ALL SELECT 'generation_jobs', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `generation_jobs`
UNION ALL SELECT 'tests', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `tests`
UNION ALL SELECT 'test_items', count(*), 'skola-zakladatelka', 'ucet-zakladatelka' FROM `test_items`;--> statement-breakpoint

/*
 Škola se přidává jako sloupec s trvalým výchozím hodnotou. SQLite jinak
 NOT NULL sloupec k neprázdné tabulce nepřidá a přestavba jedenácti tabulek
 by byla nesrovnatelně větší riziko než default, jehož nejhorší následek je,
 že by řádek bez uvedené školy spadl do zakládající — viditelná chyba, ne
 únik dat mezi školami.
*/
DROP INDEX `subjects_name_idx`;--> statement-breakpoint
ALTER TABLE `subjects` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
ALTER TABLE `subjects` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_school_name_idx` ON `subjects` (`school_id`,`name`);--> statement-breakpoint
ALTER TABLE `grades` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
ALTER TABLE `grades` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `topics` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
ALTER TABLE `topics` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `topics_school_idx` ON `topics` (`school_id`);--> statement-breakpoint
DROP INDEX `materials_content_hash_idx`;--> statement-breakpoint
ALTER TABLE `materials` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
ALTER TABLE `materials` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `materials_school_hash_idx` ON `materials` (`school_id`,`content_hash`);--> statement-breakpoint
ALTER TABLE `assets` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
DROP INDEX `questions_status_idx`;--> statement-breakpoint
DROP INDEX `questions_created_idx`;--> statement-breakpoint
ALTER TABLE `questions` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
ALTER TABLE `questions` ADD `created_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `questions` ADD `reviewed_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `questions` ADD `reviewed_at` text;--> statement-breakpoint
CREATE INDEX `questions_school_status_idx` ON `questions` (`school_id`,`status`);--> statement-breakpoint
CREATE INDEX `questions_school_created_by_idx` ON `questions` (`school_id`,`created_by`);--> statement-breakpoint
CREATE INDEX `questions_school_created_idx` ON `questions` (`school_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `templates_slug_idx`;--> statement-breakpoint
ALTER TABLE `templates` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
CREATE UNIQUE INDEX `templates_school_slug_idx` ON `templates` (`school_id`,`slug`);--> statement-breakpoint
ALTER TABLE `test_items` ADD `school_id` text NOT NULL DEFAULT 'skola-zakladatelka' REFERENCES schools(id);--> statement-breakpoint
CREATE INDEX `test_items_school_idx` ON `test_items` (`school_id`);--> statement-breakpoint

/*
 Vlastník naopak výchozí hodnotu mít nesmí: u písemky a hlavolamu by
 zapomenutý `owner_id` znamenal, že cizí práce tiše připadne někomu jinému.
 Proto tyhle tři tabulky projdou přestavbou (nová tabulka, přepis řádků,
 přejmenování). Mají jednotky až desítky řádků, takže je to levné.
 `defer_foreign_keys` odloží kontrolu cizích klíčů na konec transakce —
 `test_items` odkazuje na `tests` i na `puzzles` a bez odkladu by přejmenování
 neprošlo.
*/
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__nove_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'soukrome' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`graded` integer DEFAULT true NOT NULL,
	`template_id` text NOT NULL,
	`header` text NOT NULL,
	`variants` integer DEFAULT 1 NOT NULL,
	`show_key` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__nove_tests` (`id`, `school_id`, `owner_id`, `visibility`, `title`, `description`, `graded`, `template_id`, `header`, `variants`, `show_key`, `created_at`, `updated_at`)
SELECT `id`, 'skola-zakladatelka', 'ucet-zakladatelka', 'soukrome', `title`, `description`, `graded`, `template_id`, `header`, `variants`, `show_key`, `created_at`, `updated_at` FROM `tests`;--> statement-breakpoint
DROP TABLE `tests`;--> statement-breakpoint
ALTER TABLE `__nove_tests` RENAME TO `tests`;--> statement-breakpoint
CREATE INDEX `tests_owner_idx` ON `tests` (`school_id`,`owner_id`,`updated_at`);--> statement-breakpoint

CREATE TABLE `__nove_puzzles` (
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
);--> statement-breakpoint
INSERT INTO `__nove_puzzles` (`id`, `school_id`, `owner_id`, `topic_id`, `kind`, `title`, `instructions`, `entries`, `payload`, `model`, `created_at`, `updated_at`)
SELECT `id`, 'skola-zakladatelka', 'ucet-zakladatelka', `topic_id`, `kind`, `title`, `instructions`, `entries`, `payload`, `model`, `created_at`, `updated_at` FROM `puzzles`;--> statement-breakpoint
DROP TABLE `puzzles`;--> statement-breakpoint
ALTER TABLE `__nove_puzzles` RENAME TO `puzzles`;--> statement-breakpoint
CREATE INDEX `puzzles_topic_idx` ON `puzzles` (`topic_id`);--> statement-breakpoint
CREATE INDEX `puzzles_owner_idx` ON `puzzles` (`school_id`,`owner_id`,`updated_at`);--> statement-breakpoint

CREATE TABLE `__nove_generation_jobs` (
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
);--> statement-breakpoint
INSERT INTO `__nove_generation_jobs` (`id`, `school_id`, `requested_by`, `topic_id`, `params`, `status`, `produced_count`, `error`, `created_at`, `started_at`, `finished_at`)
SELECT `id`, 'skola-zakladatelka', 'ucet-zakladatelka', `topic_id`, `params`, `status`, `produced_count`, `error`, `created_at`, `started_at`, `finished_at` FROM `generation_jobs`;--> statement-breakpoint
DROP TABLE `generation_jobs`;--> statement-breakpoint
ALTER TABLE `__nove_generation_jobs` RENAME TO `generation_jobs`;--> statement-breakpoint
CREATE INDEX `generation_jobs_school_status_idx` ON `generation_jobs` (`school_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_topic_status_idx` ON `generation_jobs` (`topic_id`,`status`);--> statement-breakpoint
CREATE INDEX `generation_jobs_requester_status_idx` ON `generation_jobs` (`requested_by`,`status`);--> statement-breakpoint

/*
 Dosavadní obsah vytvořila zakládající učitelka — jiná v aplikaci nebyla.
 Bez toho by seznamy „moje otázky" byly od začátku poloprázdné.
*/
UPDATE `subjects` SET `created_by` = 'ucet-zakladatelka';--> statement-breakpoint
UPDATE `grades` SET `created_by` = 'ucet-zakladatelka';--> statement-breakpoint
UPDATE `topics` SET `created_by` = 'ucet-zakladatelka';--> statement-breakpoint
UPDATE `materials` SET `created_by` = 'ucet-zakladatelka';--> statement-breakpoint
UPDATE `questions` SET `created_by` = 'ucet-zakladatelka';
