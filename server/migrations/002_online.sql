-- Онлайн в админке: когда игра игрока последний раз была на связи
ALTER TABLE players ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
