-- Временные кейсы: создаёт команда в админ-боте; кейс админа команды ждёт подтверждения владельца (pending).
-- Идущие кейсы (live) и недавно закончившиеся лежат ещё и в настройке ecases — её читают игра и правила.
CREATE TABLE IF NOT EXISTS ecases (
  id       TEXT PRIMARY KEY,
  data     TEXT NOT NULL,        -- { id, event, kind, name, icon, cars, price, stars, pay, hours, from, until }
  status   TEXT NOT NULL,        -- pending | live | ended | rejected
  admin_id INTEGER,
  admin_name TEXT,
  at       INTEGER NOT NULL
);
