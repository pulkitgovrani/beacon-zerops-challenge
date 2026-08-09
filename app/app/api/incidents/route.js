import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT i.id, i.started_at, i.resolved_at, i.cause, m.name AS monitor_name
     FROM incidents i
     JOIN monitors m ON m.id = i.monitor_id
     ORDER BY i.started_at DESC
     LIMIT 30`
  );
  return Response.json({ incidents: rows });
}
