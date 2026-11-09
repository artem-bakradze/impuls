# Импульс

Сервис автоматического управления рекламой для малого бизнеса: владелец описывает бизнес и задаёт бюджет,
а сервис сам запускает и оптимизирует рекламу в Яндекс Директе, объясняет каждое действие простым языком
и позволяет его откатить. Бюджет не превышается ни при каких условиях.

- Требования: [openspec/specs](openspec/specs/); изменения в работе — [openspec/changes](openspec/changes/), исходный
  план MVP — [в архиве](openspec/changes/archive/2026-11-02-bootstrap-ad-autopilot-mvp/)
- Правила работы с кодом: [AGENTS.md](AGENTS.md)
- Архитектура: [docs/architecture.md](docs/architecture.md), предметная область: [docs/domain.md](docs/domain.md)
- Локальный запуск и тесты: [docs/development.md](docs/development.md)
- Развёртывание: [docs/deployment.md](docs/deployment.md)

## Как запустить и посмотреть

Нужен только Docker.

```bash
git clone https://github.com/artem-bakradze/impuls.git
cd impuls
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose --profile app build
docker compose --profile app run --rm worker pnpm db:migrate
docker compose --profile app up -d
```

Откройте http://localhost:3000 и нажмите «Демо-режим». Реклама идёт на учебном рынке — это симулятор Яндекс Директа,
деньги не списываются. Письма сервиса видны в http://localhost:8025. Остановить — `docker compose --profile app down`
(данные сохранятся; `down -v` удалит и их).

### С помощником на OpenAI

Без ключей помощник выключен, а объявления собираются по шаблонам. Чтобы помощник разбирал рекламу, а тексты
и картинки объявлений писала модель, перед `up` задайте:

```bash
export OPENAI_API_KEY=ваш_ключ
export AGENT_RUNTIME=openai OPENAI_AGENT_MODEL=gpt-6-luna \
  AGENT_PRICE_INPUT_RUB_PER_MTOK=10 AGENT_PRICE_OUTPUT_RUB_PER_MTOK=50 \
  AGENT_MONTHLY_LIMIT_RUB=50 AGENT_SIMULATION_RUN_LIMIT_RUB=30
export CREATIVES=openai OPENAI_TEXT_MODEL=gpt-6.1-terra \
  OPENAI_IMAGE_MODEL=gpt-image-1-mini IMAGE_PRICE_RUB=4 IMAGE_MONTHLY_LIMIT=20
docker compose --profile app up -d
```

Лимиты в рублях: дойдя до них, сервис перестаёт обращаться к модели. Цены и лимиты описаны в
[docs/deployment.md](docs/deployment.md). Из России OpenAI недоступен: нужен VPN на компьютере или прокси за рубежом
в `OPENAI_PROXY_URL`. Если VPN подменяет адреса сайтов (Hiddify, Clash), добавьте
`export PAGE_DNS_OVER_HTTPS_URL=https://dns.google/resolve`, иначе сервис не сможет прочитать сайт.

## Тесты

```bash
pnpm install
docker compose up -d --wait postgres
export DATABASE_URL=postgres://impuls:impuls@localhost:54329/impuls
pnpm db:migrate
pnpm test && pnpm test:bdd
```
