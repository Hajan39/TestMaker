-- Sloupec `search_text`: text otázky malými písmeny pro hledání v bance.
--
-- Bez něj se v bance hledalo až v prohlížeči nad vším, co se stáhlo — tedy
-- přes tisíc otázek i s obsahem při každém otevření stránky. Nově filtruje
-- databáze a do prohlížeče jde jen jedna stránka výsledků.
--
-- Malá písmena se u nových a upravovaných otázek dělají v JavaScriptu
-- (`searchTextFor` v `src/lib/questions.ts`), protože `lower()` v SQLite umí
-- jen ASCII a „Řeka“ by zůstala s velkým Ř. Dosavadní otázky se proto
-- dopočítávají tady s ručním převodem českých písmen s háčky a čárkami —
-- jinak by se v nich nedalo hledat podle slova začínajícího na Č nebo Ř,
-- dokud je učitelka neuloží znovu.

ALTER TABLE `questions` ADD `search_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `questions` SET `search_text` = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(`payload` || ' ' || coalesce(`explanation`, ''), 'Á', 'á'), 'Č', 'č'), 'Ď', 'ď'), 'É', 'é'), 'Ě', 'ě'), 'Í', 'í'), 'Ň', 'ň'), 'Ó', 'ó'), 'Ř', 'ř'), 'Š', 'š'), 'Ť', 'ť'), 'Ú', 'ú'), 'Ů', 'ů'), 'Ý', 'ý'), 'Ž', 'ž'));
