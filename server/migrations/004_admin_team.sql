-- Журнал действий админов (кто, кому, что, когда) — смотрит владелец в админ-боте
CREATE TABLE IF NOT EXISTS admin_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  admin_id  INTEGER NOT NULL,
  admin     TEXT    NOT NULL DEFAULT '',
  action    TEXT    NOT NULL,
  target    INTEGER,
  details   TEXT    NOT NULL DEFAULT ''
);
