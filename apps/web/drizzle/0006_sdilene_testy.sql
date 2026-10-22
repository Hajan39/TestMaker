-- Tests and worksheets are shared with the school by default now; existing
-- private ones become shared too (the author can hide any of them again).
-- Data only — the column itself is unchanged.
UPDATE `tests` SET `visibility` = 'skola' WHERE `visibility` = 'soukrome';
