-- Контейнеры: аукционы закрытых контейнеров с секретной/эксклюзивной машиной (запускает команда из админ-бота, один за раз).
-- Что внутри (car_id) игрокам не отдаётся, пока торги не кончились.
CREATE TABLE IF NOT EXISTS containers (
  id          TEXT PRIMARY KEY,
  n           INTEGER NOT NULL,
  car_id      TEXT NOT NULL,
  color       TEXT NOT NULL,
  start       INTEGER NOT NULL,
  price       INTEGER NOT NULL,
  bids        INTEGER NOT NULL DEFAULT 0,
  leader      INTEGER,
  leader_name TEXT,
  log         TEXT NOT NULL DEFAULT '[]',
  at          INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  status      TEXT NOT NULL,          -- open | done | cancel
  admin_id    INTEGER
);
CREATE INDEX IF NOT EXISTS containers_status ON containers (status, ends_at);
