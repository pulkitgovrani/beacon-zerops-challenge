# Beacon

A live status and incident console, built for **The Zerops Challenge**. Beacon watches
its own infrastructure — the app itself, its Postgres database, its Valkey cache — plus
a few public services, checking every ~20 seconds, recording history, and opening/closing
incidents automatically when a service flips up or down. When an incident resolves, it
writes a full report to object storage and (optionally) pings a Discord/Slack webhook.

Live URL: https://app-2d6d-3000.prg1.zerops.app/
Demo video: _fill in before submission_

## Why this project

The challenge is judged partly on how meaningfully Zerops is used. Rather than a static
app that merely happens to be hosted on Zerops, Beacon's entire premise is watching real
Zerops infrastructure in real time — it is, quite literally, an app about the platform
it runs on.

## Architecture

Five Zerops services, covering every category in the "frontend / API / private network"
model from the challenge brief:

```
                    ┌─────────────────────────┐
   public traffic → │   app (Next.js, :3000)  │  ← dashboard + /service/[id] detail pages
                    │                          │    /api/status, /api/incidents,
                    └───────────┬─────────────┘    /api/monitors/[id], /api/health
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
                    ┌───────────┴──────────────┐
                    │   worker (Node, no port)  │ → pings app/db/cache/public targets,
                    └─────────────┬─────────────┘   writes history, flips incidents,
                                  │ on resolve         optional Discord/Slack webhook
                    ┌─────────────▼─────────────┐
                    │   storage (object storage) │ ← JSON incident report per resolved
                    └─────────────────────────────┘   incident, linked from the dashboard
```

- **`app`** — Next.js. Public dashboard, a per-monitor detail page (`/service/[id]`), and
  four API routes. Reads current status from Valkey (fast path, with a timeout so a dead
  cache degrades to Postgres instead of hanging the page) with Postgres history as the
  source of truth.
- **`worker`** — Node, no public port. Long-running loop: checks every monitor, writes a
  `checks` row to Postgres, mirrors current status into Valkey, and opens/closes an
  `incidents` row on any state transition. On resolve, builds a JSON report (every check
  recorded during the incident) and uploads it to object storage. Optionally POSTs to a
  `WEBHOOK_URL` (Discord or Slack incoming webhook) on every transition.
- **`db`** — Postgres. `monitors`, `checks`, `incidents` (with a `report_url` column)
  tables. Schema is created and seeded idempotently on boot (`lib/db.js` /
  `worker/lib/db.js`), no manual migration step.
- **`cache`** — Valkey. Holds the latest status per monitor with a TTL, so the dashboard
  always has an instant read even under load, while Postgres remains the durable log.
- **`storage`** — Zerops Object Storage (S3-compatible, public-read). One JSON report per
  resolved incident at `incidents/{id}.json`, linked directly from the incident history
  and each monitor's detail page.

Click any monitor card on the dashboard for its detail page: full latency history (last
200 checks) and its own incident log with report links (`/service/[id]`, backed by
`/api/monitors/[id]`).

Internal networking: `app` and `worker` both talk to `db`, `cache`, and `storage` over
the Zerops private network using the platform's own hostname/credential interpolation
(`${db_hostname}`, `${db_user}`, `${cache_connectionString}`, `${storage_accessKeyId}`,
etc. in `zerops.yml`). The worker also checks the app's own `/api/health` over that same
private network by hostname (`http://app:3000/api/health`) — the self-monitoring loop
closes through Zerops' internal DNS, not the public internet.

## Repo layout

```
app/                        Next.js app (the "app" Zerops service)
  app/page.js                  dashboard
  app/service/[id]/page.js     per-monitor detail page
  app/api/...                  status / incidents / monitors / health routes
  lib/db.js, lib/cache.js      shared Postgres + Valkey clients

worker/                      Ping loop (the "worker" Zerops service)
  check.js                     the loop: check → record → detect transitions → report/alert
  lib/db.js, lib/cache.js      same shared clients, duplicated for an independent build
  lib/storage.js               S3-compatible client for incident reports

zerops.yml                  build/deploy config for app + worker
zerops-project-import.yml   project-creation config (db, cache, app, worker)
```

(`storage`, the object-storage service, was added after initial creation via Zerops'
"Import services" flow rather than the original project-import file — see below.)

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

Both `lib/cache.js` files accept either a single `CACHE_URL` (redis:// connection
string, what production uses) or the discrete `CACHE_HOST`/`CACHE_PORT`/`CACHE_PASSWORD`
fields (simpler for a local Valkey with no auth).

Optional, worker only:
- `WEBHOOK_URL` — a Discord or Slack incoming-webhook URL, for a message on every flip.
- `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` / `STORAGE_BUCKET` /
  `STORAGE_ENDPOINT` — S3-compatible object storage creds, for incident reports. Without
  these the worker just skips the upload (`report_url` stays null) — no crash.

Every check/incident/report code path was verified locally before ever touching Zerops:
a throwaway Postgres + Valkey spun up with `initdb`/`valkey-server`, the worker run
against them directly, and failure scenarios (a monitor going down, Valkey itself being
killed mid-run) forced by hand.

## Deploying on Zerops

1. Import `zerops-project-import.yml` as a new project (Zerops dashboard → Import
   project). It provisions `db` (Postgres) and `cache` (Valkey), and builds `app`/`worker`
   straight from this repo's GitHub URL.
2. Add the object storage service separately (dashboard → Services → Import services),
   with a YAML snippet like:
   ```yaml
   services:
     - hostname: storage
       type: object-storage
       objectStorageSize: 2
       objectStoragePolicy: public-read
   ```
3. Zerops injects the `${db_*}`, `${cache_*}`, and `${storage_*}` variables automatically;
   `zerops.yml` maps them into the env vars both services read.
4. Enable subdomain access on `app` (already set in the import file) to get a public
   HTTPS URL.
5. Connect GitHub auto-deploy on both `app` and `worker` (service → Pipelines & CI/CD →
   GitHub → Push to branch `main`) so future pushes redeploy automatically.
6. (Optional) Add `WEBHOOK_URL` as a **secret variable** on the `worker` service — then
   also add `WEBHOOK_URL: ${WEBHOOK_URL}` to worker's `envVariables` in `zerops.yml`.
   Secret variables aren't auto-injected into the process env; they only land there if
   something in `zerops.yml` explicitly references them by `${key}`, the same mechanism
   used for every other Zerops-provided value.

## Lessons learned deploying this (the honest version)

A few things didn't work on the first try, fixed live during the event:

- **Valkey auth**: composing `CACHE_PASSWORD: ${cache_password}` by direct analogy with
  the (working) `${db_password}` pattern resolved to an empty string in production, even
  though the naming convention looked identical. Fixed by switching to Zerops' own
  auto-generated `${cache_connectionString}` instead of composing host/port/password by
  hand — the variable Zerops' docs specifically call out for this.
- **Secret variables need a `zerops.yml` reference**: adding `WEBHOOK_URL` as a secret in
  the dashboard doesn't inject it into the container. It has to also appear in
  `envVariables` as `WEBHOOK_URL: ${WEBHOOK_URL}` before it reaches `process.env`.
- **A real hang bug, caught by testing the actual failure mode**: stopping the `cache`
  service for a live incident-detection test revealed the worker's check loop had no
  timeout on the Postgres/Valkey calls. When Valkey went down, `cache.ping()` hung
  waiting on ioredis's internal reconnect instead of failing fast, stalling the *entire*
  loop — every monitor froze, not just cache. The same shape of bug existed in the
  dashboard's `/api/status` route (`cache.get()` had a `.catch()` but no timeout, so it
  hung on "Connecting…" forever instead of falling back to Postgres). Both fixed with
  explicit per-operation timeouts plus an outer watchdog on the worker's run cycle.
  Verified by leaving Valkey down for a full 8 minutes live: the worker kept checking
  every ~30s throughout and correctly detected recovery — that incident's report is
  sitting in object storage as evidence (`incidents/6.json`).

## AI tool disclosure

Built during the event with Claude Code (Anthropic) as a pair-programming assistant —
scaffolding, the worker's check/incident/report logic, the storage and webhook
integrations, and every zerops.yml/import config were written interactively with it.
Each piece was reviewed, tested locally (or against real Zerops infrastructure, including
deliberately breaking services to confirm incident detection) before being committed, and
every architectural decision — including the debugging above — was understood as it
happened, not just pasted in.
