import { getPool, migrate } from "./lib/db.js";
import { getCache, statusKey } from "./lib/cache.js";

const INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 20000);
const TIMEOUT_MS = 5000;
const CACHE_TTL_SECONDS = 120;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

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
    await db.query("SELECT 1");
    return { status: "up", latency_ms: Date.now() - start };
  } catch {
    return { status: "down", latency_ms: Date.now() - start };
  }
}

async function checkValkey(cache) {
  const start = Date.now();
  try {
    const pong = await cache.ping();
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

      await cache
        .set(
          statusKey(monitor.id),
          JSON.stringify({ status: result.status, latency_ms: result.latency_ms, checked_at: new Date().toISOString() }),
          "EX",
          CACHE_TTL_SECONDS
        )
        .catch((e) => console.error("cache set failed:", e.message));

      if (prevStatus && prevStatus !== result.status) {
        if (result.status === "down") {
          await db.query(
            "INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2)",
            [monitor.id, "check failed"]
          );
        } else {
          await db.query(
            `UPDATE incidents SET resolved_at = now()
             WHERE monitor_id = $1 AND resolved_at IS NULL`,
            [monitor.id]
          );
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
      await runOnce(db, cache);
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
