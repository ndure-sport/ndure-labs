-- Database setup for NDURE Labs. Run once on a new D1 database:
--   npx wrangler d1 execute <database-name> --remote --file=schema.sql
-- The whole booking state is one JSON document (see worker/store.ts).
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO state (id, version, data, updated_at) VALUES (1, 0, '', datetime('now'));
