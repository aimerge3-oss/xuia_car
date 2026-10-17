-- Рейтинг: колонки для сортировки (выполнить ОДИН раз: npx wrangler d1 execute dropzone --remote --file=migrations/001_rating.sql)
ALTER TABLE players ADD COLUMN worth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN week_key TEXT NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN week_gain INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS players_worth ON players (worth);
CREATE INDEX IF NOT EXISTS players_week ON players (week_key, week_gain);
