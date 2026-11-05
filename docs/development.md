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
MAILPIT_SMTP_URL=smtp://localhost:1025 MAILPIT_API_URL=http://localhost:8025 pnpm test:integration
```

## Running the worker locally (simulator)

```bash
DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls \
DIRECT_API_MODE=simulator AGENT_RUNTIME=idle CREATIVES=template \
SMTP_URL=smtp://localhost:1025 MAIL_FROM="Импульс <noreply@impuls.test>" APP_URL=http://localhost:3000 TEAM_ALERT_EMAIL=team@impuls.test \
pnpm --filter @impuls/worker start
```

`AGENT_RUNTIME=heuristic` runs the deterministic test agent (insights and day reviews without model calls);
`openai` also needs `OPENAI_API_KEY`, `OPENAI_AGENT_MODEL`, the prices and the spend limits (`docs/deployment.md`).
Missing variables stop the worker with a list of problems. There are two modes: `simulator` (local, CI, staging) and
`production` (real Direct with each business's own OAuth token, needs `TOKEN_ENCRYPTION_KEY`,
`YANDEX_CLIENT_ID` and `YANDEX_CLIENT_SECRET` to renew that token). Yandex shut the Direct
sandbox down on 2026-07-15; `DIRECT_API_MODE=sandbox` is refused at startup.

## Running the web app locally

The worker must run too: web only reads PostgreSQL and enqueues jobs (`web-job` queue) that the worker executes.

```bash
DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls \
DIRECT_API_MODE=simulator SUPPORT_EMAIL=support@impuls.test \
AUTH_SECRET=$(openssl rand -base64 32) AUTH_URL=http://localhost:3000 \
pnpm --filter @impuls/web dev
```

Sign in with «Демо-режим»: a new demo account without email, bound to this browser's session, that works only in the
simulation. The Google login is off for now (the button is shown unavailable, no provider is connected), so there is no
Google OAuth client to configure. `AUTH_TEST_LOGIN=enabled` adds the email-only login, which works only in Direct mode
(the simulator's test copy of Direct on a stand).

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL |
| `AUTH_SECRET` | yes, ≥ 32 chars | Signs session cookies (Auth.js) |
| `DIRECT_API_MODE` | yes | `simulator` or `production`; `simulator` shows the «Тестовый стенд — Яндекс Директ не подключён» banner (the simulation pult replaces it on a simulated business's screens) |
| `SUPPORT_EMAIL` | yes | Support address shown in the settings; owners write there to delete the account (see `docs/deployment.md`) |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | in `production` | Yandex OAuth app «для авторизации пользователей» (not the debug app); redirect URI `<APP_URL>/api/direct/oauth/callback` |
| `TOKEN_ENCRYPTION_KEY` | in `production` | base64 of 32 random bytes (`openssl rand -base64 32`); encrypts Direct OAuth tokens, same value in worker and web |
| `APP_URL` | in `production` | Public URL of the app; the OAuth redirect URI is built from it |
| `AUTH_URL` / `AUTH_TRUST_HOST` | read by Auth.js | Public URL of the app; or `AUTH_TRUST_HOST=true` behind a trusted proxy |
| `AUTH_TEST_LOGIN` | no (off by default) | `enabled` adds an email-only login for e2e; its accounts work in Direct mode only. Never set it on a real stand; it is refused with `DIRECT_API_MODE=production` |

A missing or invalid required variable stops the server at startup with the list of problems. Sessions are signed
JWT cookies valid for 30 days since the last visit (HttpOnly, SameSite=Lax, Secure in production builds).
In `DIRECT_API_MODE=simulator` the wizard's «Подключите Яндекс Директ и запустите» step skips OAuth. In `production` it sends the
owner to Yandex (`/api/direct/oauth/start`) and stores the encrypted tokens in the callback.

### Direct contract tests (`pnpm test:contract`)

They run against the production Direct API in a dedicated test account (the sandbox is gone), only before a release or
on request:

```bash
set -a; source .env.local; set +a   # DIRECT_CONTRACT_TOKEN, DIRECT_CONTRACT_LOGIN
pnpm test:contract
```

The token comes from the debug OAuth app «Импульс» (type «Для доступа к API или отладки»):
`https://oauth.yandex.ru/authorize?response_type=token&client_id=<debug ClientID>` under the test account. Until
Yandex approves the application's API access request the run stops with «заявка на доступ к API Директа не одобрена».
See `docs/testing.md` for the safety rules.

`GET /health` returns 200, or 503 `{ code, message, stale }` when budget guard, reconciliation or the dispatcher
have not completed for 2 hours.

Full stand in Docker (web on http://localhost:3000, Mailpit on http://localhost:8025; stop a `docker run` Mailpit first):

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose --profile app up -d --build
```

Behind a VPN with fake-IP DNS (Hiddify, Clash, sing-box: every host resolves to `198.18.x.x` / `fc00::…`, even
through `8.8.8.8`), the worker refuses every owner's site as an internal address, and the card step says «Не получилось
прочитать страницу». Start the worker with `PAGE_DNS_OVER_HTTPS_URL=https://dns.google/resolve`: the check then sees
the site's real address, while the page itself is still downloaded through the VPN.

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

## Public example and saved weeks

The landing page describes the service as a demo without payment and offers one action, «Попробовать на своём бизнесе»;
the simulation of one's own business is the way to try it (`/demo` redirects to the landing page). Real advertising, when
connected, is paid in Yandex.

New simulation steps keep lifecycle state and a versioned week report in the existing `simulations.steps` JSONB;
there is no schema migration. The worker and web must be updated together. A completed report freezes observed stats,
ads, goal, explanations and the full market comparison. Later corrections appear in the current summary. Old weeks
without a report are explicitly labeled reconstructed. A failed step resumes the saved window after the owner presses
continue; it does not publish a partial week or create another window.

## Kill switches

```bash
pnpm --filter @impuls/worker cli flags set agent_enabled off --business <id>
pnpm --filter @impuls/worker cli flags set automation_enabled off   # global
pnpm --filter @impuls/worker cli agent costs --month               # model spend of the agent and paid ad pictures per business
```

## Schema changes

Edit packages/db/src/schema.ts, then `pnpm db:generate`, read the generated SQL in packages/db/drizzle/, and `pnpm db:migrate`.
