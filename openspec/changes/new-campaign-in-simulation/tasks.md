## 1. Новая кампания

- [x] 1.1 `Store.restartOnboarding` (память и PostgreSQL), `startNewCampaign` и действие `new_campaign`; пункт меню с подтверждением и переход в мастер; проверка — юнит-тест воркера, компонентный тест меню, BDD «Новая кампания», e2e.

## 2. Расход по дням

- [x] 2.1 `periodCaps` и `evenUnderLimits` в симуляторе, `recordPeriod` делит расход поровну в пределах лимитов дня и недели; проверка — юнит-тесты симулятора («неделя с понедельника», лимиты дня и недели).

## 3. Проверка

- [x] 3.1 `pnpm -r type-check`, `pnpm lint`, тесты web, юнит-тесты, BDD, e2e; `openspec validate new-campaign-in-simulation --strict`; пересобрать worker и web на стенде с тем же агентом.
