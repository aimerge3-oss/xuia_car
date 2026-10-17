-- Когда последний раз подтвердили подписку на канал (сервер спрашивает Telegram не чаще раза в 6 ч)
ALTER TABLE players ADD COLUMN sub_at INTEGER NOT NULL DEFAULT 0;
