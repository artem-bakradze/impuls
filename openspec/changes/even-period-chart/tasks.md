## 1. График по периодам

- [x] 1.1 `evenPeriods` в `summary-model.ts`, периоды из завершённых шагов в `server/summary.ts`, подсказка «в среднем за период» в `Sparkline.tsx`; проверка — модельные тесты: цена за период на каждом дне, период без обращений, период без отчёта.

## 2. Проверка

- [x] 2.1 `pnpm -r type-check`, `pnpm lint`, тесты web; `openspec validate even-period-chart --strict`; пересобрать web на стенде и посмотреть график.
