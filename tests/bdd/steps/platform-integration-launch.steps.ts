import { IdlePolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { BusinessDirectPlatform, ConfigError, handleWebJob, loadConfig, SimulationDriver } from "@impuls/worker";
import type { ExecutionResult, LaunchPlan } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { isTestMode, parseWebConfig } from "../../../apps/web/src/lib/config-check";
import { featurePath, launchedWorld } from "./world";

const modes = await loadFeature(featurePath("platform-integration/modes.feature"), { language: "ru" });
const launch = await loadFeature(featurePath("platform-integration/launch.feature"), { language: "ru" });

const workerEnv = {
  DATABASE_URL: "postgres://impuls@localhost/impuls",
  AGENT_RUNTIME: "idle",
  CREATIVES: "template",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "Импульс <noreply@impuls.test>",
  APP_URL: "https://app.example",
  TEAM_ALERT_EMAIL: "team@impuls.test",
  MINISITE_DIR: "/tmp/minisites",
};

describeFeature(modes, ({ Scenario }) => {
  Scenario("Устаревшая конфигурация песочницы", ({ Given, When, Then }) => {
    let env: Record<string, string> = {};
    let failure: unknown = null;
    Given("конфигурация сервиса с режимом песочницы, оставшимся от прежней версии", () => {
      env = { ...workerEnv, DIRECT_API_MODE: "sandbox" };
    });
    When("сервис запускается", () => {
      try {
        loadConfig(env);
      } catch (error) {
        failure = error;
      }
    });
    Then("сервис не стартует и сообщает, что режим песочницы больше не поддерживается и нужен симулятор", () => {
      expect(failure).toBeInstanceOf(ConfigError);
      expect((failure as ConfigError).problems.join()).toMatch(/sandbox is no longer supported.*use simulator/);
    });
  });

  Scenario("Боевой режим", ({ Given, When, Then, And }) => {
    const requests: string[] = [];
    let platform: BusinessDirectPlatform;
    Given("сервис запущен в режиме боевого API, и владелец бизнеса подключил свой Директ", () => {
      expect(loadConfig({ ...workerEnv, DIRECT_API_MODE: "production", TOKEN_ENCRYPTION_KEY: "key" }).DIRECT_API_MODE).toBe("production");
      platform = new BusinessDirectPlatform(
        "b1",
        (businessId) => Promise.resolve(businessId === "b1" ? "y0_owner" : null),
        () => undefined,
        (input, init) => {
          requests.push(`${input instanceof Request ? input.url : String(input)} ${(init?.headers as Record<string, string>).Authorization}`);
          return Promise.resolve(new Response(JSON.stringify({ result: { Campaigns: [] } })));
        },
      );
    });
    When("сервис читает кампании этого бизнеса", async () => {
      await platform.getAds(["101"]).catch(() => undefined);
    });
    Then("запрос уходит в боевой API Директа с токеном владельца", () => {
      expect(requests).toEqual(["https://api.direct.yandex.com/json/v5/ads Bearer y0_owner"]);
    });
    And("плашка тестового режима не показывается", () => {
      const web = parseWebConfig({
        DATABASE_URL: "postgres://impuls@localhost/impuls",
        AUTH_SECRET: "x".repeat(32),
        AUTH_GOOGLE_ID: "id",
        AUTH_GOOGLE_SECRET: "secret",
        DIRECT_API_MODE: "production",
        YANDEX_CLIENT_ID: "cid",
        YANDEX_CLIENT_SECRET: "cs",
        TOKEN_ENCRYPTION_KEY: "key",
        APP_URL: "https://app.example",
      });
      expect(isTestMode(web)).toBe(false);
    });
  });
});

const salon = async (): Promise<SimulationDriver> => {
  const sim = new SimulationDriver({ start: new Date("2026-10-28T09:00:00Z"), seed: 7, agent: new IdlePolicy() });
  const business = await sim.launchBusiness({ id: "b1", monthlyBudgetRub: 15_000, launchedOn: "2026-10-01", csoSource: { kind: "user", goal: rubles(800) }, directions: [] });
  await sim.store.saveBusiness({ ...business, launchedOn: null, card: { ...business.card, hours: "Пн–Вс 10:00–22:00" } });
  return sim;
};

const SITE = "https://nogotok.example/";
const twelve = Array.from({ length: 12 }, (_, i) => `маникюр ${i + 1}`);
const five = ["обучение", "курсы", "вакансии", "своими руками", "бесплатно"];

const plan = (direction: Partial<LaunchPlan["directions"][number]>): LaunchPlan => ({
  landingUrl: SITE,
  city: "Москва",
  directions: [
    {
      name: "Маникюр — Поиск",
      channel: "search",
      weeklyLimitRub: 1_500,
      keywords: twelve,
      negativeKeywords: five,
      ads: [
        { title: "Маникюр у метро", text: "Маникюр с покрытием за 1 800 ₽" },
        { title: "Маникюр без очереди", text: "Запись онлайн, работаем до 22:00" },
      ],
      ...direction,
    },
  ],
});

describeFeature(launch, ({ Scenario }) => {
  Scenario("Запуск поискового направления", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("владелец салона в Москве с сайтом https://nogotok.example/", async () => {
      sim = await salon();
    });
    When("он запускает направление «Маникюр — Поиск» с 12 ключевыми фразами, 5 минус-фразами и двумя объявлениями", async () => {
      await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan: plan({}) });
    });
    Then("появляется кампания только для поиска в Москве с 12 ключевыми и 5 минус-фразами", async () => {
      const [direction] = await sim.store.directions("b1");
      const settings = sim.platform.launchSettings(direction?.platformCampaignId ?? "");
      expect(settings).toMatchObject({ channel: "search", targeting: { city: "Москва", keywords: twelve, negativeKeywords: five } });
    });
    And("оба объявления ведут на сайт https://nogotok.example/", async () => {
      const ads = await sim.store.ads("b1");
      expect(ads).toHaveLength(2);
      expect(ads.map((a) => sim.platform.landingUrlOf(a.platformAdId))).toEqual([SITE, SITE]);
    });
  });

  Scenario("Запуск направления «Сайты-партнёры»", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("владелец салона в Москве с сайтом https://nogotok.example/", async () => {
      sim = await salon();
    });
    When("он запускает направление «Маникюр — Сайты-партнёры» без ключевых фраз", async () => {
      await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan: plan({ name: "Маникюр — Сайты-партнёры", channel: "network", keywords: [], negativeKeywords: [] }) });
    });
    Then("появляется кампания только для сайтов-партнёров", async () => {
      const [direction] = await sim.store.directions("b1");
      expect(direction?.channel).toBe("network");
      expect(sim.platform.launchSettings(direction?.platformCampaignId ?? "").channel).toBe("network");
    });
  });

  Scenario("Поисковое направление без ключевых фраз", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let failure: unknown = null;
    Given("владелец салона в Москве с сайтом https://nogotok.example/", async () => {
      sim = await salon();
    });
    When("он запускает направление «Маникюр — Поиск» без ключевых фраз", async () => {
      failure = await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan: plan({ keywords: [] }) }).then(
        () => null,
        (error: unknown) => error,
      );
    });
    Then("кампания не создаётся", async () => {
      expect(await sim.store.directions("b1")).toHaveLength(0);
    });
    And("владелец видит «Не получилось подобрать поисковые запросы для этой услуги — уточните описание услуги»", () => {
      expect(failure).toMatchObject({ code: "NO_KEYWORDS", message: "Не получилось подобрать поисковые запросы для этой услуги — уточните описание услуги" });
    });
  });

  Scenario("Стратегия с оплатой за обращения без цели Метрики", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let result: ExecutionResult | null = null;
    Given("запущенная реклама бизнеса без цели Метрики", async () => {
      sim = await launchedWorld(30_000);
      await sim.store.saveBusiness({ ...(await sim.store.getBusiness("b1")), leadGoalId: null });
    });
    When("агент предлагает перевести направление на оплату за обращения", async () => {
      const [direction] = await sim.store.directions("b1");
      result = await sim.executor.execute({
        businessId: "b1",
        command: { type: "SetStrategy", directionId: direction?.id ?? "", strategyId: "AVERAGE_CPA" },
        actor: "agent",
        reasonCode: "AGENT_STRATEGY",
        explanation: "Перевёл на оплату за обращения.",
      });
    });
    Then("команда отклоняется с причиной «нет цели для подсчёта обращений»", () => {
      expect(result).toMatchObject({ status: "rejected", code: "NO_LEAD_GOAL", message: "нет цели для подсчёта обращений" });
    });
    And("стратегия кампании в Директе не меняется", async () => {
      const [direction] = await sim.store.directions("b1");
      const [campaign] = await sim.platform.getCampaigns([direction?.platformCampaignId ?? ""]);
      expect(campaign?.strategyId).toBe("WB_MAXIMUM_CLICKS");
    });
  });
});
