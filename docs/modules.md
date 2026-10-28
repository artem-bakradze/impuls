# Adding modules

## A new platform adapter

1. Implement `AdPlatform` (packages/platforms/src/contract.ts) and `capabilities()` (strategies with spend limits, minimum weekly limit).
2. Map platform errors to `PlatformError(code, message, retryable)`; retry only idempotent reads, ≤ 5 attempts, each logged.
3. Report stats with VAT in kopecks, by day and ad. Emulate nothing: missing features throw `NOT_SUPPORTED`.
4. Add unit tests with a fake transport and a `*.contract.test.ts` that fails fast without credentials.
Core, guards, agent tools and UI must not change (platform-integration spec).

## A new command

1. Add it to `Command` in packages/core/src/types.ts and handle it in `guard()` (every actor).
2. Resolve its target and apply it in `CommandExecutor` (apps/worker/src/executor.ts); log before/after.
3. Declare `reversible`, `rollbackConsequences` (or `irreversibleReason`) in `ACTION_META` and an inverse in `inverseCommands`.
4. Add it to the round-trip test in apps/worker/src/commands.test.ts.

## A new agent tool

Add a zod schema and description in packages/agent/src/tools.ts. Never accept a business ID; actions require a
justification and must map to a `Command` so they go through the executor.

## A new job

Write a handler `(ctx: JobContext, businessId) → Promise` and call it from `dispatchHour` in the right order;
cover it with a `SimulationDriver` scenario.
