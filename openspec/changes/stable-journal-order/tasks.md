## 1. База

- [x] 1.1 Столбец `seq bigint generated always as identity` и индекс `change_log_business_time` на `(business_id, created_at, seq)` в `packages/db/src/schema.ts`; `pnpm db:generate --name stable_journal_order`, проверка SQL (без удалений), `pnpm db:migrate` локально.

## 2. Хранилище

- [x] 2.1 `PgStore.changes` сортирует по `created_at, seq`; `ChangeEntry` не меняется; проверка — интеграционный тест: равное время, обновление статуса в обратном порядке, порядок вставки сохраняется (со старой сортировкой падает).
- [x] 2.2 Откат изменения владельца при равном времени с изменением агента не требует цепочки; проверка — интеграционный тест отката на `PgStore`.

## 3. Студия

- [x] 3.1 `useSimulation` держит нажатый шаг до движения на сервере или конца задачи; проверка — компонентный тест студии (без исправления падает).
- [x] 3.2 e2e симуляции после шага проверяет, что день сдвинулся.

## 4. Проверка

- [x] 4.1 `pnpm -r type-check`, `pnpm lint`, тесты web, юнит-тесты, интеграционные тесты worker, BDD.
- [x] 4.2 e2e три прогона подряд без падений; `openspec validate stable-journal-order --strict`.
