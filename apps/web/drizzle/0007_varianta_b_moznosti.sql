-- How variant B is built (order, option shuffling, seed) as JSON; NULL = defaults,
-- which give exactly the variant B printed before this column existed.
ALTER TABLE `tests` ADD `variant_options` text;