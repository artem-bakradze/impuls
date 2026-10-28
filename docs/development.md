# Development setup

Requirements: Node.js 24, pnpm 11 (`corepack enable`), Docker.

```bash
pnpm install
docker compose up -d --wait postgres
docker run -d --rm --name impuls-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit   # test inbox at http://localhost:8025

export DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls
pnpm db:migrate

pnpm lint && pnpm type-check
pnpm test            # unit
pnpm test:bdd        # Russian BDD scenarios
docker run -d --rm --name impuls-s3 -p 9000:9090 adobe/s3mock   # S3-compatible store for photo tests
MAILPIT_SMTP_URL=smtp://localhost:1025 MAILPIT_API_URL=http://localhost:8025 S3_TEST_ENDPOINT=http://localhost:9000 pnpm test:integration
```

## Running the worker locally (simulator)

```bash
DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls \
DIRECT_API_MODE=simulator AGENT_RUNTIME=idle \
SMTP_URL=smtp://localhost:1025 MAIL_FROM="Импульс <noreply@impuls.test>" APP_URL=http://localhost:3000 TEAM_ALERT_EMAIL=team@impuls.test \
pnpm --filter @impuls/worker start
```

Missing variables stop the worker with a list of problems. `DIRECT_API_MODE=sandbox|production` needs the
Yandex Direct adapter wiring with OAuth tokens and refuses to start until it exists.

## Running the web app locally

The worker must run too: web only reads PostgreSQL and enqueues jobs (`web-job` queue) that the worker executes.

```bash
DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls \
DIRECT_API_MODE=simulator \
AUTH_SECRET=$(openssl rand -base64 32) AUTH_URL=http://localhost:3000 \
AUTH_GOOGLE_ID=<Google OAuth client id> AUTH_GOOGLE_SECRET=<Google OAuth client secret> \
pnpm --filter @impuls/web dev
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL |
| `AUTH_SECRET` | yes, ≥ 32 chars | Signs session cookies (Auth.js) |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | yes | Google OAuth client; redirect URI `<AUTH_URL>/api/auth/callback/google` |
| `DIRECT_API_MODE` | yes | `simulator`, `sandbox` or `production`; anything but `production` shows the «Тестовый режим» banner |
| `AUTH_URL` / `AUTH_TRUST_HOST` | read by Auth.js | Public URL of the app; or `AUTH_TRUST_HOST=true` behind a trusted proxy |
| `AUTH_TEST_LOGIN` | no (off by default) | `enabled` adds an email-only login for e2e. Never set it on a real stand; it is refused with `DIRECT_API_MODE=production` |

A missing or invalid required variable stops the server at startup with the list of problems. Sessions are signed
JWT cookies valid for 30 days since the last visit (HttpOnly, SameSite=Lax, Secure in production builds).
In `DIRECT_API_MODE=simulator` the wizard's «Подключите Яндекс Директ» step skips OAuth.

`GET /health` returns 200, or 503 `{ code, message, stale }` when budget guard, reconciliation or the dispatcher
have not completed for 2 hours.

Full stand in Docker (web on http://localhost:3000, Mailpit on http://localhost:8025; stop a `docker run` Mailpit first):

```bash
export AUTH_SECRET=$(openssl rand -base64 32) AUTH_GOOGLE_ID=... AUTH_GOOGLE_SECRET=...
docker compose --profile app up -d --build
```

## E2E (Playwright)

```bash
docker compose up -d --wait postgres
docker run -d --rm --name impuls-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
pnpm --filter @impuls/web exec playwright install chromium   # once
DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls pnpm e2e
```

`pnpm e2e` builds web, recreates the database `<name>_e2e` on the same server and migrates it, starts the worker on the
simulator and `next start` on port 3100 with `AUTH_TEST_LOGIN=enabled`, then runs `apps/web/e2e/*.spec.ts`
(login → wizard → launch, logout, settings hours change, history rollback, pause/resume). The simulator keeps
campaigns in the worker's memory, which is why e2e uses its own database.

Web unit and component tests (Vitest + Testing Library, jsdom): `pnpm --filter @impuls/web test`.

## Kill switches

```bash
pnpm --filter @impuls/worker cli flags set agent_enabled off --business <id>
pnpm --filter @impuls/worker cli flags set automation_enabled off   # global
```

## Schema changes

Edit packages/db/src/schema.ts, then `pnpm db:generate`, read the generated SQL in packages/db/drizzle/, and `pnpm db:migrate`.
