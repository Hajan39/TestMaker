ALTER TABLE `tests` ADD `grade_id` text REFERENCES grades(id) ON DELETE set null;
