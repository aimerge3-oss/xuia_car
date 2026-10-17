-- Оплаты Telegram Stars: каждый платёж засчитывается один раз (charge_id — от Telegram)
CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  stars INTEGER NOT NULL,
  at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
