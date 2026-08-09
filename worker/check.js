import { getPool, migrate } from "./lib/db.js";
import { getCache, statusKey } from "./lib/cache.js";
import { uploadIncidentReport } from "./lib/storage.js";

const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 20000);
const TIMEOUT_MS = 5000;
const CACHE_TIMEOUT_MS = 2000;
const CACHE_TTL_SECONDS = 120;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function checkHttp(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(target, { signal: controller.signal, redirect: "follow" });
    const latency = Date.now() - start;
    return { status: res.ok ? "up" : "down", latency_ms: latency };
  } catch {
    return { status: "down", latency_ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPostgres(db) {
  const start = Date.now();
  try {
    await withTimeout(db.query("SELECT 1"), TIMEOUT_MS, "postgres check");
    return { status: "up", latency_ms: Date.now() - start };
  } catch {
    return { status: "down", latency_ms: Date.now() - start };
  }
}

async function checkValkey(cache) {
  const start = Date.now();
  try {
    const pong = await withTimeout(cache.ping(), CACHE_TIMEOUT_MS, "valkey check");
    return { status: pong === "PONG" ? "up" : "down", latency_ms: Date.now() - start };
  } catch {
    return { status: "down", latency_ms: Date.now() - start };
  }
}

async function notify(monitorName, from, to) {
  if (!WEBHOOK_URL) return;
  const emoji = to === "down" ? "🔴" : "🟢";
  const message = `${emoji} **${monitorName}** flipped ${from} → ${to}`;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch (err) {
    console.error("webhook notify failed:", err.message);
  }
}

async function runOnce(db, cache) {
  const { rows: monitors } = await db.query(
    "SELECT id, name, kind, target FROM monitors ORDER BY sort_order ASC"
  );

  for (const monitor of monitors) {
    let result;
    try {
      if (monitor.kind === "postgres") {
        result = await checkPostgres(db);
      } else if (monitor.kind === "valkey") {
        result = await checkValkey(cache);
      } else {
        result = await checkHttp(monitor.target);
      }
    } catch (err) {
      console.error(`check failed for ${monitor.name}:`, err.message);
      result = { status: "down", latency_ms: null };
    }

    try {
      const { rows: prevRows } = await db.query(
        "SELECT status FROM checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1",
        [monitor.id]
      );
      const prevStatus = prevRows[0]?.status;

      await db.query(
        "INSERT INTO checks (monitor_id, status, latency_ms) VALUES ($1, $2, $3)",
        [monitor.id, result.status, result.latency_ms]
      );

      await withTimeout(
        cache.set(
          statusKey(monitor.id),
          JSON.stringify({ status: result.status, latency_ms: result.latency_ms, checked_at: new Date().toISOString() }),
          "EX",
          CACHE_TTL_SECONDS
        ),
        CACHE_TIMEOUT_MS,
        "cache set"
      ).catch((e) => console.error("cache set failed:", e.message));

      if (prevStatus && prevStatus !== result.status) {
        if (result.status === "down") {
          await db.query(
            "INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2)",
            [monitor.id, "check failed"]
          );
        } else {
          const { rows: resolved } = await db.query(
            `UPDATE incidents SET resolved_at = now()
             WHERE monitor_id = $1 AND resolved_at IS NULL
             RETURNING id, started_at, resolved_at, cause`,
            [monitor.id]
          );
          for (const incident of resolved) {
            try {
              const { rows: incidentChecks } = await db.query(
                `SELECT status, latency_ms, checked_at FROM checks
                 WHERE monitor_id = $1 AND checked_at BETWEEN $2 AND $3
                 ORDER BY checked_at ASC`,
                [monitor.id, incident.started_at, incident.resolved_at]
              );
              const report = {
                incident_id: incident.id,
                monitor: { id: monitor.id, name: monitor.name, kind: monitor.kind, target: monitor.target },
                started_at: incident.started_at,
                resolved_at: incident.resolved_at,
                cause: incident.cause,
                checks_during_incident: incidentChecks,
                generated_at: new Date().toISOString(),
              };
              const reportUrl = await uploadIncidentReport(incident.id, report);
              if (reportUrl) {
                await db.query("UPDATE incidents SET report_url = $1 WHERE id = $2", [reportUrl, incident.id]);
              }
            } catch (err) {
              console.error(`failed to build/upload report for incident ${incident.id}:`, err.message);
            }
          }
        }
        await notify(monitor.name, prevStatus, result.status);
      }

      console.log(`[${new Date().toISOString()}] ${monitor.name}: ${result.status} (${result.latency_ms}ms)`);
    } catch (err) {
      console.error(`failed to record check for ${monitor.name}:`, err.message);
    }
  }
}

async function main() {
  const db = getPool();
  const cache = getCache();

  await migrate();
  console.log("beacon-worker started, checking every", INTERVAL_MS, "ms");

  const loop = async () => {
    try {
      await withTimeout(runOnce(db, cache), INTERVAL_MS * 3, "run cycle");
    } catch (err) {
      console.error("run failed:", err);
    }
    setTimeout(loop, INTERVAL_MS);
  };

  loop();
}

main().catch((err) => {
  console.error("worker fatal error:", err);
  process.exit(1);
});
