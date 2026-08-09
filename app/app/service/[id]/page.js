"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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

function BigChart({ history }) {
  const points = history.filter((h) => h.latency_ms != null);
  if (points.length < 2) {
    return <div className="h-40 flex items-center justify-center text-sm text-[#5f7168]">Not enough data yet</div>;
  }
  const w = 720;
  const h = 160;
  const latencies = points.map((p) => p.latency_ms);
  const max = Math.max(...latencies, 1);
  const min = Math.min(...latencies, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);

  const linePath = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p.latency_ms - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
        <path d={areaPath} fill="#4ade8018" stroke="none" />
        <path d={linePath} fill="none" stroke="#4ade80" strokeWidth="1.5" />
        {points.map((p, i) => {
          if (p.status !== "down") return null;
          const x = i * step;
          return <circle key={i} cx={x} cy={h - ((p.latency_ms - min) / range) * h} r="3" fill="#ef4444" />;
        })}
      </svg>
      <div className="flex justify-between text-xs text-[#5f7168] mt-1">
        <span>{min}ms min</span>
        <span>{max}ms max</span>
      </div>
    </div>
  );
}

export default function MonitorDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`/api/monitors/${id}`, { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        // keep last good state on transient network errors
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (!data) {
    return (
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 font-mono text-sm text-[#5f7168]">
        Loading…
      </main>
    );
  }

  if (data.error) {
    return (
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 font-mono text-sm text-[#5f7168]">
        Monitor not found. <Link href="/" className="underline text-[#7fd8a8]">Back</Link>
      </main>
    );
  }

  const { monitor, history, incidents } = data;
  const upCount = history.filter((h) => h.status === "up").length;
  const uptime = history.length > 0 ? (upCount / history.length) * 100 : null;

  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 font-mono">
      <Link href="/" className="text-xs text-[#7fd8a8] hover:underline">
        ← back to dashboard
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold">{monitor.name}</h1>
        <p className="text-sm text-[#8aa298] mt-1">
          {monitor.kind}
          {monitor.target ? ` · ${monitor.target}` : ""}
        </p>
      </header>

      <section className="rounded-lg border border-[#1c2622] bg-[#0b0f0d] px-4 py-4 mb-8">
        <div className="flex items-center justify-between mb-3 text-xs text-[#5f7168]">
          <span>latency, last {history.length} checks</span>
          <span>{uptime != null ? `${uptime.toFixed(1)}% up over window` : "—"}</span>
        </div>
        <BigChart history={history} />
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-widest text-[#7fd8a8] mb-3">
          Incident history
        </h2>
        {incidents.length === 0 ? (
          <p className="text-sm text-[#5f7168]">No incidents recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {incidents.map((inc) => (
              <li key={inc.id} className="text-sm border-l-2 border-[#2a3630] pl-3">
                <span className="text-[#5f7168]">
                  {inc.resolved_at ? "resolved" : "ongoing"}, lasted {duration(inc.started_at, inc.resolved_at)}
                  {" · "}
                  started {timeAgo(inc.started_at)}
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
    </main>
  );
}
