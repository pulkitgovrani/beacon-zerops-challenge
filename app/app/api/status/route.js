import { getPool, migrate } from "@/lib/db";
import { getCache, statusKey } from "@/lib/cache";

export const dynamic = "force-dynamic";

let migrated = false;

export async function GET() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }

  const db = getPool();
  const cache = getCache();

  const { rows: monitors } = await db.query(
    "SELECT id, name, kind, target FROM monitors ORDER BY sort_order ASC"
  );

  const results = await Promise.all(
    monitors.map(async (m) => {
      const [cached, historyRes, incidentRes] = await Promise.all([
        cache.get(statusKey(m.id)).catch(() => null),
        db.query(
          "SELECT status, latency_ms, checked_at FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 20",
          [m.id]
        ),
        db.query(
          "SELECT id, started_at FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1",
          [m.id]
        ),
      ]);

      const history = historyRes.rows.reverse();
      const latest = cached ? JSON.parse(cached) : history[history.length - 1] || null;

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { rows: uptimeRows } = await db.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'up')::int AS up
         FROM checks WHERE monitor_id = $1 AND checked_at > $2`,
        [m.id, dayAgo]
      );
      const uptime = uptimeRows[0].total > 0 ? (uptimeRows[0].up / uptimeRows[0].total) * 100 : null;

      return {
        id: m.id,
        name: m.name,
        kind: m.kind,
        status: latest?.status || "pending",
        latency_ms: latest?.latency_ms ?? null,
        checked_at: latest?.checked_at || null,
        uptime_24h: uptime,
        sparkline: history.map((h) => h.latency_ms),
        active_incident: incidentRes.rows[0] || null,
      };
    })
  );

  const anyDown = results.some((r) => r.status === "down");
  const anyPending = results.some((r) => r.status === "pending");

  return Response.json({
    overall: anyDown ? "degraded" : anyPending ? "starting" : "operational",
    monitors: results,
    server_time: new Date().toISOString(),
  });
}
