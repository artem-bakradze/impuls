## 1. Шаг без конца

- [x] 1.1 `step` в `apps/worker/src/simulation-mode.ts`: шаг за `endsAt` сначала продлевает прогон на `SIMULATION_DAYS` с пересчётом контрольного прогона; проверка — BDD «Неделя у конца сценария».

## 2. Плеер

- [x] 2.1 `SimulationPlayer` без «из N», сценария, полоски дней, «завершён», «Продолжить ещё 30 дней» и «Прожить оставшиеся N дней»; `stepWeekLabel` удалить; стили полоски и сценария удалить; проверка — компонентные тесты плеера.

## 3. Проверка

- [x] 3.1 `pnpm -r type-check`, `pnpm lint`, тесты web, юнит-тесты, BDD и e2e; `openspec validate simulation-without-end --strict`; пересобрать web и worker на стенде.
