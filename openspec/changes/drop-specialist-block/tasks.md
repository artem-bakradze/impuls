## 1. Настройки без блока для специалистов

- [x] 1.1 `SettingsView`: убрать «Для специалистов»; `SettingsModel` и `buildSettings` без `directions` и `budgetAdjustments`; проверка — компонентный тест настроек: блока, стратегий, лимитов и подстроек нет.

## 2. Проверка

- [x] 2.1 `pnpm -r type-check`, `pnpm lint`, тесты web и e2e; `openspec validate drop-specialist-block --strict`; пересобрать web на стенде.
