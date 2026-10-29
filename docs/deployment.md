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

1. `staging` — `DIRECT_API_MODE=simulator` (market simulator, no real impressions; the Direct sandbox was shut down on 2026-07-15).
2. `production` — `DIRECT_API_MODE=production`, allowlisted users first.

## Worker configuration (all required unless marked)

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_API_MODE` | `simulator` \| `production` |
| `TOKEN_ENCRYPTION_KEY` | required in `production`: base64 of 32 bytes, same as in web; decrypts Direct OAuth tokens |
| `AGENT_RUNTIME` | `openai` (agent on the OpenAI Agents API) or `idle` (no agent: guards and safety net only) |
| `OPENAI_AGENT_MODEL` | required with `AGENT_RUNTIME=openai`, e.g. `gpt-6.1-sol` |
| `CREATIVES` | `openai` (card extraction and ad texts by the LLM) or `template` (card-only drafts, local stand and e2e) |
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` | required with `CREATIVES=openai`; text model `gpt-6.1-terra` (see `docs/research/agents-api.md` for the agent model) |
| `SMTP_URL`, `MAIL_FROM` | outgoing email |
| `APP_URL` | public web URL for links in emails |
| `TEAM_ALERT_EMAIL` | incidents are emailed here |
| `OPENAI_PROXY_URL` | optional egress proxy |

The worker refuses to start with missing or invalid values and prints every problem.

## Yandex OAuth applications

| Application | Type | Used for |
| --- | --- | --- |
| «Импульс», ClientID `56df642386ba4b89b3df0c7b11eb30e2` | «Для доступа к API или отладки», redirect URI fixed to `https://oauth.yandex.ru/verification_code` | manual token for contract tests only |
| user-facing app (to be created, task 1.1 of `replace-direct-sandbox`) | «для авторизации пользователей», redirect `<APP_URL>/api/direct/oauth/callback` per environment | owners connect Direct; `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` in web |

Direct API access is approved per application. The request for the debug app was sent on 2026-10-29 (status «новая»).
Whether the approval carries over to the user-facing app is to be confirmed with Direct support (task 1.2).

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
