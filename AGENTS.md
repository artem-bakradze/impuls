# AGENTS.md

## Scope & Operational Context

* **Product**: «Импульс» — automated ad management for small businesses (Yandex Direct API v5, Yandex Metrica, OpenAI Agents API). Requirements live in OpenSpec: `openspec/specs/` (accepted) and `openspec/changes/` (in progress). The spec is the source of truth; if code and spec disagree, raise it instead of silently picking one.
* **Language**: User communication MUST be in Russian. Code, comments, schema and identifiers are in English. User-facing errors and UI MUST be in Russian, plain, and non-technical, with no ad-industry jargon (see the stop-list in `change-history` spec). Internal logs MUST be in English.
* **Environment**: Default runtime is local development via Docker Compose with `DIRECT_API_MODE=simulator` (the market simulator; Yandex shut the Direct sandbox down on 2026-07-15). Run safe development commands without confirmation, but DO NOT make git commits or push code unless explicitly requested.
* **System Neutrality**: Never assume a specific host OS. Use forward slashes for paths; validate commands against the live shell.
* **Scope Discipline**: Make minimal necessary changes. Do not perform unsolicited refactoring or stylistic reformatting of unrelated code.

## Core Tech Stack

| Domain | Technology / Tooling | Execution Context & Rules |
| --- | --- | --- |
| **Monorepo** | TypeScript (strict), pnpm workspaces | `apps/web`, `apps/worker`, `packages/core`, `packages/platforms`, `packages/agent`, `packages/db`, `e2e`; zero `any` where possible; no plain `.js` source |
| **Web** | Next.js (App Router), React, Ant Design | UI and API routes; reads the DB and enqueues commands and jobs; no external side effects except OAuth code exchange |
| **Worker** | Node.js, pg-boss (queue + cron on PostgreSQL) | The only command executor; job handlers separated from schedules (pg-boss in prod, `SimulationDriver` in tests); stats sync, platform reconciliation, budget-guard, safety-net, agent turns |
| **Core** | `packages/core` | Pure functions only (classification, guard, safety-net, budget-guard, experiments): no I/O, no randomness except seeded, time via injected `Clock` |
| **Platforms** | `packages/platforms` | `AdPlatform` contract; adapters `yandex-direct` (production API) and `simulator` |
| **Data** | PostgreSQL 16, Drizzle ORM + drizzle-kit migrations | All schema changes via generated migrations |
| **Agent** | `packages/agent`: `AgentRuntime` port (OpenAI Agents API, test policies, replay) and `LlmClient` | On by default (`agent_enabled` is true globally after migrations) and always on in the simulation mode; every action and observation comes with an insight checked against the turn's fact catalog. The deterministic rules are the safety net: they act on what the agent left and decide alone when it is off, unavailable or out of its cost limit. Runs inside worker; one Agents API session per turn, deleted after the journal is saved; model spend is counted per turn and limited per business and per simulation run; outbound traffic via optional `OPENAI_PROXY_URL` |
| **Mini-sites** | Static HTML published to S3-compatible storage | Served from a separate registrable domain without app cookies, never by `apps/web` |
| **Testing** | Vitest, vitest-cucumber (BDD), Playwright | BDD for business behavior, Vitest for core/scenarios, Playwright for e2e |
| **Search & Recon** | `rg` (ripgrep) | Targeted full reads for edits |

## Essential Development Commands

Run commands from the repository root inside the Docker Compose dev environment documented in `docs/development.md`. Inspect `compose.yaml` and root `package.json` first; do not assume service or script names that are not defined there.

```bash
# BDD suite (mandatory after business behavior changes)
docker compose exec -T worker pnpm test:bdd

# Core unit and simulator scenario tests (mandatory after changes in packages/core or packages/platforms)
docker compose exec -T worker pnpm test

# Generate DB migration (mandatory for schema changes), review the SQL, then apply locally
docker compose exec -T worker pnpm db:generate --name <description>
docker compose exec -T worker pnpm db:migrate

# Type & lint verification (mandatory after TS/TSX edits)
pnpm -r type-check
pnpm -r lint
```

* Type checking does not replace relevant tests or a build when the change requires them. If a required check cannot run, report the reason and which validation remains incomplete.
* **Paid / external suites run only on explicit request**: the agent eval (`pnpm eval:agent`, calls OpenAI) and Direct contract tests (`pnpm test:contract`, production API in a dedicated test account, drafts only; need `DIRECT_CONTRACT_TOKEN` and `DIRECT_CONTRACT_LOGIN`). If credentials are missing they MUST fail fast, not be skipped silently.

> **OpenSpec Notice**: OpenSpec workflows (`/opsx:propose`, `/opsx:apply`, `/opsx:update`, `/opsx:sync`, `/opsx:archive`, `/opsx:explore`) are conversational chat workflows. Trigger them via prompt commands, not as direct shell scripts. The `openspec` CLI itself (`openspec validate --strict`, `openspec status`) may be run in the shell.

## Code Reading Protocol

1. **Targeted read**: Before editing specific files, read them in full without compression to see exact line numbers and logic.
2. **Spec first**: Before changing behavior, read the relevant `spec.md` and the related decision in `design.md`.

## Hard Invariants & Non-Negotiable Rules

### 1. No-Fallbacks Policy (Strict Fail-Fast)
* Missing required configuration (env vars and secrets) MUST fail fast at startup or before the operation that needs it. Validate required auth tokens, DB fields, and request parameters at their relevant boundaries and return explicit errors.
* **FORBIDDEN**: Inventing fallback values for required system parameters or masking missing config behind defaults (e.g., `process.env.KEY ?? "fallback"` is forbidden for required parameters).
* **ALLOWED**: Documented defaults for optional configuration; presentation-only fallbacks in UI for optional labels/placeholders/empty states; degraded modes that the spec defines explicitly (work without the agent in `ad-agent`, forecast placeholder text in `business-onboarding`). Do not use defaults to bypass required validation or authentication.
* No hidden retries. Retries are allowed only when explicitly required, idempotent, bounded, and logged (e.g., Direct API transient errors per `platform-integration`).

### 2. Money & Automation Invariants
* Every change to ads, limits, strategies, schedules, budgets or mini-sites MUST go through the command executor in `worker`: per-business lock → current state and expected `before` check → validation, `guard()` and `budget-guard` → `change_log` (`pending`) → platform adapter → `applied`/`failed`. `web` only enqueues commands. No direct platform calls from UI, agent tools or ad-hoc scripts.
* Guards are evaluated against the current state at execution time, never against the agent's turn snapshot. The snapshot only provides decision facts for explanation checks.
* Platform state can change outside the service (Direct cabinet, platform-side changes). Never assume DB state equals platform state; reconciliation and the expected-`before` check handle drift.
* Agent tools resolve the business from the server-side turn binding, never from tool arguments; object IDs in arguments are checked for ownership.
* Kill switches (`agent_enabled`, `automation_enabled`) are runtime flags in the DB, global and per business. Never implement them as env vars.
* `budget-guard`, `guard()`, classification, safety-net rules and the A/B verdict are deterministic code. The agent and LLM output MUST NOT be able to bypass, override or reconfigure them.
* Never modify, pause or count campaigns that the service did not create.
* Every reversible command declares `isReversible` and `rollbackConsequences`; rollback is a command and goes through the same path.

### 3. Data & Privacy
* Schema changes MUST be accompanied by a generated Drizzle migration. Always inspect the generated SQL for accidental drops or unintended alterations.
* No personal data (user name, email, client answers per person) and no tokens may be sent to OpenAI or any other LLM provider. Agent context and tool results are serialized from an explicit field allowlist of public business data and aggregated stats.
* OAuth tokens are stored encrypted. Direct API request/response logs are kept for at least 3 days with tokens redacted.

### 4. BDD Testing Invariants
* Feature files: `tests/bdd/features/<capability>/*.feature` (one `Функционал:` block per file, first line: `# language: ru`). Each spec scenario that describes business behavior maps to a BDD scenario.
* Step definitions: `tests/bdd/steps/`. Prefer reusing existing shared steps over adding new ones.
* Describe behavior in business language; keep API and simulator mechanics in step definitions.
* When adding or changing business behavior, add or update the corresponding BDD scenario. For technical changes that do not alter business behavior, use unit or integration tests; purely cosmetic edits do not require new BDD scenarios.
* **Async steps**: every async step MUST be `async` and fully awaited; floating promises are forbidden (`@typescript-eslint/no-floating-promises` is an error).
* Time-dependent behavior is tested with `SimulationDriver` (virtual clock + simulator), never with real sleeps or real pg-boss schedules.

### 5. Error Handling & Observability
* Do not swallow errors in domain logic; catch only at boundary layers (API routes, worker jobs, agent tool handlers).
* User-facing error messages MUST be plain, non-technical Russian text. API error responses MUST include a stable error code in a separate field (e.g., `DIRECT_TOKEN_REVOKED`); the UI displays the message and may expose the code as a support reference. No stack traces or raw SQL leaks.
* Internal logs: English, structured, with safe diagnostic parameters and correlation IDs (business ID, command ID, agent turn ID). Never log passwords, auth tokens, secrets, or sensitive personal data. Redact sensitive values before logging.

```ts
// CORRECT: boundary-level explicit error handling
try {
  await service.process(input);
} catch (err) {
  if (err instanceof DomainValidationError) {
    logger.warn({ errorCode: "INVALID_PAYLOAD", requestId }, "Domain validation failed");
    return NextResponse.json(
      { code: "INVALID_PAYLOAD", message: "Некорректные данные запроса" },
      { status: 400 },
    );
  }
  throw err;
}

// WRONG: swallowing the error or returning a vague message
try {
  await service.process(input);
} catch {
  return NextResponse.json("Error");
}
```

### 6. OpenSpec Planning Protocol
* Run `/opsx:propose` FIRST for new business capabilities, public API contract changes, database schema changes, changes to agent tools or guardrails, or changes to component boundaries and interactions.
* Do NOT write implementation code in the same step as `/opsx:propose`.
* Small localized bugfixes, cosmetic edits, documentation updates, and internal refactoring bypass OpenSpec when they do not meet the criteria above. For these changes, state a brief plan and proceed. If the scope expands to meet those criteria, create a proposal before implementing the expanded scope.
* Keep artifacts valid: `openspec validate --strict` must pass after editing specs.

## Documentation Index (Progressive Disclosure)

Consult these files for specialized context when working on relevant subsystems:

| Subject Area | Target File Pointer | Content Scope |
| --- | --- | --- |
| Requirements | `openspec/specs/`, `openspec/changes/` | Capability specs, proposals, design, tasks |
| Architecture & Layers | `docs/architecture.md` | System boundaries, dependency rules, command executor, agent runtime, platform reconciliation |
| Domain & Invariants | `docs/domain.md` | Directions, ЦСО, classification, guardrails, budget rules |
| Testing Layout | `docs/testing.md` | Test strategy, BDD layout, simulator and `SimulationDriver`, test agent policies, replay, eval |
| Module Structure | `docs/modules.md` | Guidelines for adding packages, platform adapters, agent tools |
| Development Setup | `docs/development.md` | Local Docker setup, commands, Direct contract-test credentials |
| Deployment | `docs/deployment.md` | Environments, migrations, runtime flags, egress proxy, mini-site hosting, monitoring |
| Decisions | `docs/adr/` | Architectural decisions and their rationale |

Files in `docs/` were created during implementation (task group 1 in `openspec/changes/archive/2026-11-02-bootstrap-ad-autopilot-mvp/tasks.md`); for a subsystem they do not cover yet, use `design.md` of the active change.
