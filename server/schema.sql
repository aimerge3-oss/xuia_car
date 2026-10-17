-- Игроки: прогресс хранится одним JSON (state), ver — защита от одновременных запросов
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY,   -- Telegram ID
  name       TEXT    NOT NULL DEFAULT '',
  username   TEXT    NOT NULL DEFAULT '',
  state      TEXT    NOT NULL,
  ver        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  worth      INTEGER NOT NULL DEFAULT 0,   -- рейтинг: стоимость гаража
  week_key   TEXT    NOT NULL DEFAULT '',  -- рейтинг: неделя (дата понедельника)
  week_gain  INTEGER NOT NULL DEFAULT 0,   -- рейтинг: прирост гаража за неделю
  last_seen  INTEGER NOT NULL DEFAULT 0,   -- когда игра последний раз была на связи (онлайн в админке)
  sub_at     INTEGER NOT NULL DEFAULT 0    -- когда последний раз подтвердили подписку на канал
);
-- журнал действий админов
CREATE TABLE IF NOT EXISTS admin_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  admin_id  INTEGER NOT NULL,
  admin     TEXT    NOT NULL DEFAULT '',
  action    TEXT    NOT NULL,
  target    INTEGER,
  details   TEXT    NOT NULL DEFAULT ''
);
-- для старой базы колонки добавляет migrations/001_rating.sql

-- Настройки игры (например, техработы): key → JSON
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Промокоды: reward — JSON награды, max_uses 0 = без лимита, expires_at 0 = бессрочно
CREATE TABLE IF NOT EXISTS promos (
  code       TEXT PRIMARY KEY,
  reward     TEXT    NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 0,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Кто какой промокод уже активировал (один раз на игрока)
CREATE TABLE IF NOT EXISTS promo_uses (
  code      TEXT    NOT NULL,
  player_id INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (code, player_id)
);

-- Приглашения: кто кого привёл (один раз на игрока)
CREATE TABLE IF NOT EXISTS referrals (
  player_id INTEGER PRIMARY KEY,
  ref_id    INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  paid      INTEGER NOT NULL DEFAULT 1   -- деньги пригласившему выплачены (новые — когда друг дойдёт до REFERRAL.minLevel)
);
CREATE INDEX IF NOT EXISTS referrals_ref ON referrals (ref_id);

-- Пришёл по ссылке, но ещё не вошёл в игру (например, не подписан на канал)
CREATE TABLE IF NOT EXISTS pending_refs (
  id     INTEGER PRIMARY KEY,
  ref_id INTEGER NOT NULL,
  at     INTEGER NOT NULL
);

-- Номера: каждый номер существует в одном экземпляре (ключ 'А123ВС|77')
CREATE TABLE IF NOT EXISTS plates (
  key   TEXT PRIMARY KEY,
  owner INTEGER NOT NULL,
  at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plates_owner ON plates (owner);
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  stars INTEGER NOT NULL,
  at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS friends (
  a  INTEGER NOT NULL,
  b  INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS duels (
  id     TEXT PRIMARY KEY,
  a      INTEGER NOT NULL,      -- кто вызвал
  b      INTEGER NOT NULL,      -- кого вызвали
  bet    INTEGER NOT NULL,
  status TEXT NOT NULL,         -- wait | go | cancel
  at     INTEGER NOT NULL,
  a_run  TEXT,
  b_run  TEXT
);
CREATE TABLE IF NOT EXISTS market (
  id          TEXT PRIMARY KEY,
  seller      INTEGER NOT NULL,
  seller_name TEXT,
  kind        TEXT NOT NULL,            -- car | part | plate
  lot         TEXT NOT NULL,            -- сам лот (JSON, как в S.lots)
  search      TEXT NOT NULL DEFAULT '', -- для поиска: название, деталь, номер
  value       INTEGER NOT NULL,
  price       INTEGER NOT NULL,         -- цена; у аукциона — текущая ставка или стартовая
  at          INTEGER NOT NULL,
  until       INTEGER NOT NULL,
  status      TEXT NOT NULL,            -- open | sold | cancel | expired
  auc         INTEGER NOT NULL DEFAULT 0,
  start       INTEGER,
  buyout      INTEGER,
  bid         INTEGER NOT NULL DEFAULT 0,
  bids        INTEGER NOT NULL DEFAULT 0,
  bidder      INTEGER,
  bidder_name TEXT,
  buyer       INTEGER
);
CREATE INDEX IF NOT EXISTS market_open ON market (status, until);
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
CREATE TABLE IF NOT EXISTS ecases (
  id       TEXT PRIMARY KEY,
  data     TEXT NOT NULL,        -- { id, event, kind, name, icon, cars, price, stars, pay, hours, from, until }
  status   TEXT NOT NULL,        -- pending | live | ended | rejected
  admin_id INTEGER,
  admin_name TEXT,
  at       INTEGER NOT NULL
);
