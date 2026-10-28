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
DIRECT_API_MODE=simulator AGENT_RUNTIME=idle \
SMTP_URL=smtp://localhost:1025 MAIL_FROM="Импульс <noreply@impuls.test>" APP_URL=http://localhost:3000 \
pnpm --filter @impuls/worker start
```

Missing variables stop the worker with a list of problems. `DIRECT_API_MODE=sandbox|production` needs the
Yandex Direct adapter wiring with OAuth tokens and refuses to start until it exists.

## Kill switches

```bash
pnpm --filter @impuls/worker cli flags set agent_enabled off --business <id>
pnpm --filter @impuls/worker cli flags set automation_enabled off   # global
```

## Schema changes

Edit packages/db/src/schema.ts, then `pnpm db:generate`, read the generated SQL in packages/db/drizzle/, and `pnpm db:migrate`.
