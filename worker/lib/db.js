import { Pool } from "pg";

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 5,
    });
  }
  return pool;
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS monitors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'http',
  target TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checks (
  id BIGSERIAL PRIMARY KEY,
  monitor_id INT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  latency_ms INT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  monitor_id INT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  cause TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_monitor ON incidents(monitor_id);
`;

const SEED_MONITORS = [
  { name: "Beacon App (self)", kind: "http", target: "http://app:3000/api/health", sort_order: 1 },
  { name: "Postgres (db)", kind: "postgres", target: null, sort_order: 2 },
  { name: "Valkey (cache)", kind: "valkey", target: null, sort_order: 3 },
  { name: "Zerops", kind: "http", target: "https://zerops.io", sort_order: 4 },
  { name: "WeMakeDevs", kind: "http", target: "https://www.wemakedevs.org", sort_order: 5 },
  { name: "GitHub", kind: "http", target: "https://github.com", sort_order: 6 },
];

export async function migrate() {
  const db = getPool();
  await db.query(MIGRATION_SQL);
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM monitors");
  if (rows[0].count === 0) {
    for (const m of SEED_MONITORS) {
      await db.query(
        "INSERT INTO monitors (name, kind, target, sort_order) VALUES ($1, $2, $3, $4)",
        [m.name, m.kind, m.target, m.sort_order]
      );
    }
  }
}
