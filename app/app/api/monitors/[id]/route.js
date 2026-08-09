import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const { id } = await context.params;
  const db = getPool();

  const { rows: monitorRows } = await db.query(
    "SELECT id, name, kind, target FROM monitors WHERE id = $1",
    [id]
  );
  if (monitorRows.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const { rows: history } = await db.query(
    `SELECT status, latency_ms, checked_at FROM checks
     WHERE monitor_id = $1
     ORDER BY checked_at DESC
     LIMIT 200`,
    [id]
  );

  const { rows: incidents } = await db.query(
    `SELECT id, started_at, resolved_at, cause, report_url
     FROM incidents
     WHERE monitor_id = $1
     ORDER BY started_at DESC
     LIMIT 20`,
    [id]
  );

  return Response.json({
    monitor: monitorRows[0],
    history: history.reverse(),
    incidents,
  });
}
