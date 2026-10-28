# Deployment

The hosting provider is not chosen yet (task 0.5). The service needs only standard building blocks (design.md D12):

| Piece | Requirement |
| --- | --- |
| `worker` | Docker image (`pnpm --filter @impuls/worker start`), one or more replicas; pg-boss guarantees one hourly dispatch |
| `web` | Docker image of `apps/web` |
| PostgreSQL 16 | in Russia (152-ФЗ), with backups |
| S3-compatible storage | static hosting with TLS for the mini-site domain `*.<mini-site-domain>` (no app cookies) |
| SMTP | notification emails |
| Egress to OpenAI | via `OPENAI_PROXY_URL` (HTTPS CONNECT proxy outside Russia) when hosted in Russia; see the legal check (task 0.7) |

## Environments

1. `staging` — `DIRECT_API_MODE=sandbox` (Yandex Direct sandbox, no real impressions).
2. `production` — `DIRECT_API_MODE=production`, allowlisted users first.

## Worker configuration (all required unless marked)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_API_MODE` | `simulator` \| `sandbox` \| `production` |
| `AGENT_RUNTIME` | `idle` until the OpenAI Agents API runtime exists |
| `SMTP_URL`, `MAIL_FROM` | outgoing email |
| `APP_URL` | public web URL for links in emails |
| `OPENAI_PROXY_URL` | optional egress proxy |

The worker refuses to start with missing or invalid values and prints every problem.

## Release

1. `pnpm db:migrate` against the target database (migrations are additive: expand → contract).
2. Deploy `worker`, then `web`. Rollback = previous images; mini-sites keep working because they are static.

## Kill switches (no deploy needed)

```bash
pnpm --filter @impuls/worker cli flags set agent_enabled off [--business <id>]       # agent only
pnpm --filter @impuls/worker cli flags set automation_enabled off [--business <id>]  # also safety net and experiments
```

The budget guard always keeps running.

## Monitoring

Poll `GET /health` of `web` from an external monitor: it fails when the budget guard, reconciliation or the
dispatcher has not completed for 2 hours (and opens an incident). Also monitor the mini-site domain.
