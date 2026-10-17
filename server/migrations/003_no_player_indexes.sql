-- Индексы players удваивали число записей в базу на каждое действие (бесплатный лимит D1 — 100 000 строк в сутки).
-- При ~150 игроках рейтинг и онлайн считаются полным проходом мгновенно. Сервер убирает их и сам (slimIndexes).
DROP INDEX IF EXISTS players_last_seen;
DROP INDEX IF EXISTS players_worth;
DROP INDEX IF EXISTS players_week;
