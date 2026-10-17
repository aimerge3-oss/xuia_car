-- Гонки с друзьями: друзья по коду (обе стороны) и сами гонки (заезды хранятся здесь, сопернику — только после его заезда)
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
