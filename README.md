# Beacon

A live status and incident console, built for **The Zerops Challenge**. Beacon watches
its own infrastructure — the app itself, its Postgres database, its Valkey cache — plus
a few public services, checking every ~20 seconds, recording history, and opening/closing
incidents automatically when a service flips up or down.

Live URL: _fill in after deploy_
Demo video: _fill in before submission_

## Why this project

The challenge is judged partly on how meaningfully Zerops is used. Rather than a static
app that merely happens to be hosted on Zerops, Beacon's entire premise is watching real
Zerops infrastructure in real time — it is, quite literally, an app about the platform
it runs on.

## Architecture

Four Zerops services, matching the "frontend / API / private network" model from the
challenge brief:

```
                    ┌─────────────────────────┐
   public traffic → │   app (Next.js, :3000)  │  ← dashboard UI + /api/status, /api/incidents, /api/health
                    └───────────┬─────────────┘
                                │ reads
                    ┌───────────┴─────────────┐
                    │                         │
              ┌─────▼─────┐             ┌─────▼─────┐
              │  db        │             │  cache     │
              │  postgres  │◄────────────┤  valkey    │
              │  (history, │   writes    │  (live     │
              │  incidents)│             │  status)   │
              └─────▲──────┘             └─────▲──────┘
                    │                          │
                    └──────────┬───────────────┘
                                │ checks every ~20s
                    ┌───────────┴─────────────┐
                    │   worker (Node, no port)│ → pings app/db/cache/public targets,
                    └──────────────────────────┘   writes history, flips incidents,
                                                     optional webhook alert
```

- **`app`** — Next.js. Public dashboard + three API routes. Reads current status from
  Valkey (fast path) with Postgres history as the fallback/source of truth.
- **`worker`** — Node, no public port. Long-running loop: checks every monitor, writes
  a `checks` row to Postgres, mirrors current status into Valkey, and opens/closes an
  `incidents` row on any state transition. Optionally POSTs to a `WEBHOOK_URL` (Discord
  or Slack incoming webhook) on transitions.
- **`db`** — Postgres. `monitors`, `checks`, `incidents` tables. Schema is created and
  seeded idempotently on boot (see `lib/db.js` / `worker/lib/db.js`), no manual
  migration step needed.
- **`cache`** — Valkey. Holds the latest status per monitor with a TTL, so the dashboard
  always has an instant read even under load, while Postgres remains the durable log.

Internal networking: `app` and `worker` both talk to `db` and `cache` over the Zerops
private network using the platform's own hostname/credential interpolation
(`${db_hostname}`, `${db_user}`, `${cache_hostname}`, etc. in `zerops.yml`). The worker
also checks the app's own `/api/health` over the same private network by hostname
(`http://app:3000/api/health`) — the self-monitoring loop closes through Zerops'
internal DNS, not the public internet.

## Repo layout

```
app/      Next.js app (the "app" Zerops service)
worker/   Ping loop (the "worker" Zerops service)
zerops.yml                 build/deploy config for both services
zerops-project-import.yml  project-creation config (db, cache, app, worker)
```

## Local development

Requires a local Postgres and Valkey/Redis (or point at remote ones).

```bash
cd app && npm install && npm run build && \
  DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=... DB_PASSWORD=... \
  CACHE_HOST=... CACHE_PORT=6379 npm start

cd worker && npm install && \
  DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=... DB_PASSWORD=... \
  CACHE_HOST=... CACHE_PORT=6379 node check.js
```

Optional: set `WEBHOOK_URL` on the worker to a Discord or Slack incoming-webhook URL to
get a message on every status flip.

## Deploying on Zerops

1. Import `zerops-project-import.yml` as a new project (Zerops dashboard → Import
   project). It provisions `db` (Postgres), `cache` (Valkey), and builds `app`/`worker`
   straight from this repo's GitHub URL.
2. Zerops injects the `${db_*}` and `${cache_*}` variables automatically; `zerops.yml`
   maps them into the env vars both services read.
3. Enable subdomain access on `app` (already set in the import file) to get a public
   HTTPS URL.
4. Connect GitHub auto-deploy on both services (service → Pipelines & CI/CD → GitHub) so
   future pushes redeploy automatically.
5. (Optional) Add a `WEBHOOK_URL` secret env var on the `worker` service for live alerts.

## AI tool disclosure

Built during the event with Claude Code (Anthropic) as a pair-programming assistant —
scaffolding, the worker's check/incident logic, and the zerops.yml/import config were
written interactively with it, with each piece reviewed, locally tested against a real
throwaway Postgres + Valkey instance, and understood before being committed.
