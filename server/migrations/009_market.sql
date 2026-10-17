-- Торговая площадка: общие лоты всех игроков. Вещь лежит в лоте (в прогрессе продавца — S.lots),
-- купить можно, только «забрав» лот: status open → sold одним UPDATE (никто не купит дважды).
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
