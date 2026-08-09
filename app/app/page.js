"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const STATUS_COLOR = {
  up: "#22c55e",
  operational: "#22c55e",
  down: "#ef4444",
  pending: "#6b7280",
};

function StatusDot({ status }) {
  const color = STATUS_COLOR[status] || STATUS_COLOR.pending;
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
    />
  );
}

function Sparkline({ values }) {
  const points = (values || []).filter((v) => v != null);
  if (points.length < 2) {
    return <div className="h-8 w-full" />;
  }
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const step = w / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-80">
      <path d={path} fill="none" stroke="#4ade80" strokeWidth="1.5" />
    </svg>
  );
}

function timeAgo(iso) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function duration(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef(null);

  useEffect(() => {
    async function poll() {
      try {
        const [statusRes, incidentsRes] = await Promise.all([
          fetch("/api/status", { cache: "no-store" }),
          fetch("/api/incidents", { cache: "no-store" }),
        ]);
        setData(await statusRes.json());
        setIncidents((await incidentsRes.json()).incidents || []);
      } catch (e) {
        // keep last good state on transient network errors
      }
    }
    poll();
    pollRef.current = setInterval(poll, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(tick);
    };
  }, []);

  const overall = data?.overall || "starting";
  const bannerCopy =
    overall === "operational"
      ? "All systems operational"
      : overall === "degraded"
      ? "Degraded — one or more services down"
      : "Starting up — waiting on first checks";
  const bannerColor =
    overall === "operational" ? "#22c55e" : overall === "degraded" ? "#ef4444" : "#6b7280";

  return (
    <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10 font-mono">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#7fd8a8]">
          <span>BEACON</span>
          <span className="text-[#3a4a44]">/</span>
          <span className="text-[#7fd8a8]/70">live ops console</span>
        </div>
        <h1 className="text-2xl font-semibold mt-1">Beacon</h1>
        <p className="text-sm text-[#8aa298] mt-1">
          Watching its own infrastructure on Zerops — app, Postgres, and Valkey — plus a
          few public services, in real time.
        </p>
      </header>

      <div
        className="flex items-center gap-3 rounded-lg px-4 py-3 mb-6 border"
        style={{ borderColor: bannerColor + "55", backgroundColor: bannerColor + "14" }}
      >
        <StatusDot status={overall === "operational" ? "up" : overall === "degraded" ? "down" : "pending"} />
        <span className="text-sm">{bannerCopy}</span>
        <span className="ml-auto text-xs text-[#5f7168]">
          updated {timeAgo(data?.server_time)}
        </span>
      </div>

      <div className="grid gap-3">
        {(data?.monitors || []).map((m) => (
          <Link
            href={`/service/${m.id}`}
            key={m.id}
            className="flex items-center gap-4 rounded-lg border border-[#1c2622] bg-[#0b0f0d] px-4 py-3 hover:border-[#2a3630] transition-colors"
          >
            <StatusDot status={m.status} />
            <div className="flex-1 min-w-0">
              <div className="text-sm">{m.name}</div>
              <div className="text-xs text-[#5f7168]">
                {m.kind} · checked {timeAgo(m.checked_at)}
                {m.active_incident ? (
                  <span className="text-red-400"> · incident open {duration(m.active_incident.started_at)}</span>
                ) : null}
              </div>
            </div>
            <Sparkline values={m.sparkline} />
            <div className="text-right w-16 text-xs text-[#8aa298]">
              {m.latency_ms != null ? `${m.latency_ms}ms` : "—"}
            </div>
            <div className="text-right w-16 text-xs text-[#8aa298]">
              {m.uptime_24h != null ? `${m.uptime_24h.toFixed(1)}%` : "—"}
            </div>
          </Link>
        ))}
        {!data && (
          <div className="text-sm text-[#5f7168] py-8 text-center">Connecting…</div>
        )}
      </div>

      <section className="mt-10">
        <h2 className="text-sm uppercase tracking-widest text-[#7fd8a8] mb-3">
          Incident history
        </h2>
        {incidents.length === 0 ? (
          <p className="text-sm text-[#5f7168]">No incidents recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {incidents.map((inc) => (
              <li key={inc.id} className="text-sm border-l-2 border-[#2a3630] pl-3">
                <span className="text-[#e6f1ec]">{inc.monitor_name}</span>{" "}
                <span className="text-[#5f7168]">
                  — {inc.resolved_at ? "resolved" : "ongoing"}, lasted{" "}
                  {duration(inc.started_at, inc.resolved_at)}
                </span>
                {inc.report_url ? (
                  <>
                    {" "}
                    <a
                      href={inc.report_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#4ade80] underline hover:text-[#7fd8a8]"
                    >
                      report
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 text-xs text-[#3a4a44]">
        Built for The Zerops Challenge · deployed on Zerops
      </footer>
    </main>
  );
}
