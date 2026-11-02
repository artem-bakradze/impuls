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
| `TOKEN_ENCRYPTION_KEY` | required in `production`: base64 of 32 bytes, same as in web; encrypts and decrypts Direct OAuth tokens |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | required in `production`: the same user-authorization OAuth app as in web; the worker renews the business's Direct token with it |
| `AGENT_RUNTIME` | `openai` (agent on the OpenAI Agents API; required with `DIRECT_API_MODE=production`), `heuristic` (deterministic test agent with insights, free: e2e and a stand) or `idle` (no agent: guards and safety net only) |
| `OPENAI_AGENT_MODEL` | required with `AGENT_RUNTIME=openai`: `gpt-6-luna` (chosen on 2026-10-30 after `pnpm eval:agent`, see `docs/research/agents-api.md`) |
| `AGENT_PRICE_INPUT_RUB_PER_MTOK`, `AGENT_PRICE_OUTPUT_RUB_PER_MTOK` | required with `AGENT_RUNTIME=openai`: the model's price in rubles per million input and output tokens |
| `AGENT_MONTHLY_LIMIT_RUB` | required with `AGENT_RUNTIME=openai`: model spend per business per month; above it the rules decide until the 1st |
| | For `gpt-6-luna`: prices `10` and `50` (≈$0.10 / $0.50 per million at 100 ₽ per dollar — check the OpenAI price list and the rate before a release), monthly limit `50` (a month of daily reviews is ≈12–20 ₽ by the estimate), run limit `30`. |
| `AGENT_SIMULATION_RUN_LIMIT_RUB` | required with `AGENT_RUNTIME=openai`: model spend per simulation run (a restart starts a new run) |
| `OPENAI_STRATEGY_MODEL` | optional, with `AGENT_RUNTIME=openai` only: the model of the Monday weekly review, e.g. `gpt-6.1-sol`; without it the review runs on `OPENAI_AGENT_MODEL` |
| `AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK`, `AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK` | required with `OPENAI_STRATEGY_MODEL`: its price in rubles per million tokens. Its spend counts in the same monthly and run limits: with `gpt-6.1-sol` (a review ≈9 ₽ by the estimate) plan the monthly limit as daily turns plus ≈4–5 reviews, e.g. `100` |
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

## Showing the mechanics in 10 minutes (simulation mode)

Works in any environment, including production; nothing reaches the Direct API and no money is spent on ads. With
`AGENT_RUNTIME=openai` the agent's turns are paid (only on days with reasons and on Mondays, within
`AGENT_SIMULATION_RUN_LIMIT_RUB`); a week without model calls takes under 30 s, plus the agent's reviews (≈17 s
each). «Повторить этот прогон» replays a run without the model. `heuristic` shows the same screens for free.

1. Sign in, go through the wizard (budget from 10 000 ₽, keep at least 2 search ads for «Одно объявление не приносит
   клиентов»).
2. On step 6 choose «Симуляция»: «Обычный месяц» is selected, the others are under «Другие сценарии». Press
   «Запустить симуляцию». The simulated month starts on the 1st of the next month; the time stands until you step it.
3. Press «Прожить неделю» on the pult (or «Прожить первую неделю» on the summary): the pult says which day goes and
   when the service reviews a day; then «Как решает сервис» opens with the week's story — the ads' numbers with the
   service's estimate and the scenario's truth, the service's insights one by one, its decisions with the guard's
   answers and «Вернуть как было», and the comparison «с сервисом / без сервиса». «Показать сразу» skips the scenes.
4. Below the story: the comparison by day, the checklist of what the scenario shows (with «обычно к N-му дню») and the
   feed of the run, where every insight about an ad or advertising says «На самом деле: …».
   «Вы отменили изменение одной кнопкой» is ticked after any rollback, from the history or from a card.
5. «Начать заново» offers «Повторить этот прогон» (the same decisions without the model, the same numbers while you
   act the same) and «Прогнать заново» (the agent decides again). The pult's menu (⋯) has «+1 день» and «Запустить
   по-настоящему»; the latter deletes the simulation and opens step 6 with the same card, budget and ads.

## Kill switches (no deploy needed)

```bash
pnpm --filter @impuls/worker cli flags set agent_enabled off [--business <id>]       # agent only; the rules decide
pnpm --filter @impuls/worker cli flags set agent_enabled on                          # back on (on after migrations)
pnpm --filter @impuls/worker cli flags set automation_enabled off [--business <id>]  # also safety net and experiments
```

The budget guard always keeps running. A global «off» wins over a business value. Before releasing a new agent model
or instructions version run `pnpm eval:agent` (paid): the agent must not be more expensive than the rules, on the
analyst scenarios it must be at least 10% cheaper (`ANALYST_SHARE`), and its insights, hypotheses and day reviews must
pass the checks (`MIN_VALID_SHARE`). With `OPENAI_STRATEGY_MODEL` set the eval runs the weekly reviews on it.

## Agent costs

```bash
pnpm --filter @impuls/worker cli agent costs --month [YYYY-MM]   # model spend per business; a simulation: its current run
```

Each turn stores its tokens, their source (`api` or `estimate`) and the cost in kopecks. The OpenAI project budget
limit stays as the outer fuse.

## Account deletion (on request)

Owners ask for deletion at `SUPPORT_EMAIL` (shown in the settings); there is no button in the app. Check that the
request comes from the account's email, then queue the deletion to the running worker:

```bash
pnpm --filter @impuls/worker cli account delete <businessId>
```

The worker stops the service's campaigns in Direct, revokes the stored OAuth tokens, switches automation off for the
business and marks the owner deleted; personal data is purged within 30 days by the daily job. Reply to the owner:
«Реклама остановлена, данные будут удалены».

## Monitoring

Poll `GET /health` of `web` from an external monitor: it fails when the budget guard, reconciliation or the
dispatcher has not completed for 2 hours (and opens an incident). Also monitor the mini-site domain.
