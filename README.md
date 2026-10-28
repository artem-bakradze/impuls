# Импульс

Сервис автоматического управления рекламой для малого бизнеса: владелец описывает бизнес и задаёт бюджет,
а сервис сам запускает и оптимизирует рекламу в Яндекс Директе, объясняет каждое действие простым языком
и позволяет его откатить. Бюджет не превышается ни при каких условиях.

- Требования и план: [openspec/changes/bootstrap-ad-autopilot-mvp](openspec/changes/bootstrap-ad-autopilot-mvp/)
- Правила работы с кодом: [AGENTS.md](AGENTS.md)
- Архитектура: [docs/architecture.md](docs/architecture.md), предметная область: [docs/domain.md](docs/domain.md)
- Локальный запуск и тесты: [docs/development.md](docs/development.md)
- Развёртывание: [docs/deployment.md](docs/deployment.md)

## Быстрый старт

```bash
pnpm install
docker compose up -d --wait postgres
export DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls
pnpm db:migrate
pnpm test && pnpm test:bdd
```
