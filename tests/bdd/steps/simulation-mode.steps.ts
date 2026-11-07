import { HeuristicPolicy, IdlePolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, BreakdownAnswer, TurnResult, TurnSnapshot } from "@impuls/agent";
import { addDays, monthBudget, rubles, toLocalDate } from "@impuls/core";
import { checkPeriod, controlSimulation, createLogger, DEFAULT_PERIOD_DAYS, deliverNotifications, handleWebJob, launchSimulation, MARKET, runAgentTurn, suggestPeriod, withSimulation } from "@impuls/worker";
import type { Mailer, PeriodMarket } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import { simulationWords } from "../../../apps/web/src/lib/day-words";
import { noteTitle } from "../../../apps/web/src/lib/review-note";
import { launchModeFor } from "../../../apps/web/src/lib/account-mode";
import { currentAction, periodDaysText, periodReviewText, PLAYER_MENU, SimulationControlBody } from "../../../apps/web/src/lib/simulation-model";
import type { JournalEntry } from "../../../apps/web/src/lib/service-work";
import { BAD, GOOD, HeldAgent, ownerPlan, ownerWorld, PLAIN, REAL_START } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("simulation-mode/simulation.feature"), { language: "ru" });

const words = simulationWords("2026-11-01");
const plain = (text: string | null | undefined) => text?.replace(/[  ]/g, " ") ?? "";
const NO_LEADS = { impressions: 1_800, clicks: 90, leads: 0, spendRub: 1_600 };
const CHEAP_LEADS = { impressions: 1_500, clicks: 50, leads: 5, spendRub: 400 };
/** Two weeks of an ad that spends without leads beside one that brings them cheaply: after the second the service acts. */
const FIRST_WEEK = { [BAD]: { impressions: 1_500, clicks: 80, leads: 0, spendRub: 900 }, [GOOD]: { impressions: 1_500, clicks: 50, leads: 5, spendRub: 500 } };
const SECOND_WEEK = { [BAD]: { impressions: 1_000, clicks: 50, leads: 0, spendRub: 900 }, [GOOD]: { impressions: 1_000, clicks: 40, leads: 4, spendRub: 400 } };

/** Asks the breakdowns of every direction and keeps the answers. */
class BreakdownProbe implements AgentRuntime {
  readonly name = "policy:breakdown-probe";
  readonly instructionsVersion = "test";
  readonly decides = true;
  readonly answers: BreakdownAnswer[] = [];
  async runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    for (const direction of input.snapshot.directions) {
      this.answers.push(await input.tools.breakdown(direction.id, "device"), await input.tools.breakdown(direction.id, "query"));
    }
    return { summary: "Посмотрел разбивку.", calls: [], usage: null };
  }
}

/** A mark a page from before market-leaks-live-review sends: accepted and not counted. */
const PHONES: PeriodMarket = { junkQuery: false, phonesWorse: true };
/** The spec's numbers in search need room: a goal of 1 000 ₽, a weekly limit of 4 800 ₽ and a month budget-guard keeps it in. */
const ROOMY = { goalRub: 1_000, searchWeeklyRub: 4_800, monthlyBudgetRub: 45_000 };
const WEEK_4200 = { impressions: 1_400, clicks: 70, leads: 7, spendRub: 4_200 };
const JUNK_QUERY = "маникюр москва фото";
const sumRows = (rows: readonly { impressions: number; clicks: number; leads: number; spend: number }[]) =>
  rows.reduce((s, r) => ({ impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, leads: s.leads + r.leads, spend: s.spend + r.spend }), { impressions: 0, clicks: 0, leads: 0, spend: 0 });
/** What the period's agent changed: the test policy's decisions are the service's. */
const decided = async (w: OwnerWorld) => (await w.store.changes("b1")).filter((c) => c.author === "service" && c.status === "applied");
/** The breakdowns of a period's turn as the agent gets them from its tool. */
const agentBreakdowns = async (w: OwnerWorld, period: { from: string; to: string }) => {
  const probe = new BreakdownProbe();
  await withSimulation(w.ctx, "b1", async (world) => {
    await runAgentTurn({ ...world.ctx, agent: probe }, "b1", { kind: "period_review", ...period });
  });
  return probe.answers.flatMap((a) => (a.status === "ok" ? [a] : []));
};

/** The period sections of the history, and the service's records in them. */
const sectionOf = async (w: OwnerWorld, from: string) => (await w.work()).journal.find((s) => s.period && s.from === from);
const serviceEntries = (entries: readonly JournalEntry[] | undefined) => (entries ?? []).filter((e) => e.kind !== "owner");

describeFeature(feature, ({ Scenario }) => {
  Scenario("Запуск в симуляции без Директа", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("владелец демо прошёл мастер с бюджетом 15 000 ₽", async () => {
      w = await ownerWorld(new HeuristicPolicy(), { launch: false });
    });
    When("он нажимает «Запустить симуляцию»", async () => {
      // The page sends no mode: the demo's own is the simulation (simulation-mode «Режим бизнеса «Симуляция»»).
      expect(launchModeFor("demo", {})).toEqual({ ok: true, mode: "simulation" });
      expect((await launchSimulation(w.ctx, "b1", ownerPlan)).status).toBe("launched");
    });
    Then("кампании созданы на учебном рынке, а в Директ не ушло ни одного запроса", async () => {
      expect((await w.store.directions("b1")).length).toBe(2);
      expect((await w.record()).state.campaigns.length).toBe(2);
      expect((await w.store.getBusiness("b1")).mode).toBe("simulation");
      expect(w.directCalls).toEqual([]);
    });
    And("в истории есть запись «Реклама запущена»", async () => {
      expect((await w.store.changes("b1"))[0]?.explanation).toMatch(/^Реклама запущена/);
    });
    And("у объявлений нет показов, переходов и расходов, пока владелец не внёс статистику", async () => {
      expect(await w.store.stats("b1", "2026-10-01", "2027-01-31")).toEqual([]);
      expect((await w.record()).state.truths).toEqual([]);
    });
  });

  Scenario("Месяц симуляции — календарный", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("владелец прошёл мастер с бюджетом 15 000 ₽ 30 октября", async () => {
      w = await ownerWorld(new HeuristicPolicy(), { launch: false });
      w.clock.set(REAL_START);
    });
    When("он выбирает «Запустить в симуляции»", async () => {
      await launchSimulation(w.ctx, "b1", ownerPlan);
    });
    Then("симуляция начинается 1 ноября в 09:00 с полным бюджетом месяца 15 000 ₽, а плеер показывает «День 1»", async () => {
      const simulation = await w.record();
      expect(simulation.startedAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
      const start = toLocalDate(simulation.startedAt, "Europe/Moscow");
      expect(monthBudget(15_000, start, start)).toBe(rubles(15_000));
      expect((await w.player()).day).toBe(1);
    });
  });

  Scenario("Неделя с цифрами владельца", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("на 1-й день владелец вносит за неделю у объявления «Маникюр с покрытием» 1 400 показов, 70 переходов, 0 обращений и 1 530 ₽ расхода", async () => {
      await w.enter(7, { [PLAIN]: { impressions: 1_400, clicks: 70, leads: 0, spendRub: 1_530 } });
    });
    Then("дни 1–7 прожиты, а статистика объявления за них — ровно эти цифры и видна сразу", async () => {
      expect(await w.totals(PLAIN)).toEqual({ impressions: 1_400, clicks: 70, leads: 0, spend: rubles(1_530) });
      const dates = new Set((await w.store.stats("b1", "2026-10-01", "2027-01-31")).map((r) => r.date));
      expect([...dates].every((d) => d >= "2026-11-01" && d <= "2026-11-07")).toBe(true);
    });
    And("плеер говорит «День 8», а сервис разобрал период одним ходом агента", async () => {
      expect(await w.player()).toMatchObject({ day: 8, status: "paused", periods: 1 });
      expect((await w.store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review"]);
    });
  });

  Scenario("Сервис решает по этим цифрам", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции с тестовой политикой агента", async () => {
      w = await ownerWorld(new HeuristicPolicy());
    });
    When("владелец две недели подряд вносит у одного объявления расход без обращений, а у другого того же направления — обращения дешевле цели", async () => {
      await w.enter(7, FIRST_WEEK);
      await w.enter(7, SECOND_WEEK);
    });
    Then("после второго периода объявление без обращений отключено агентом или страховочным правилом, а его цифры — в фактах решения", async () => {
      const ad = (await w.store.ads("b1")).find((a) => a.title === BAD && a.status === "paused");
      expect(ad).toBeDefined();
      const pause = (await w.store.changes("b1")).find((c) => (c.actor === "agent" || c.actor === "safety_net") && c.status === "applied" && c.action.type === "PauseAd" && c.objectId === ad?.id);
      const insight = (await w.store.insights("b1")).find((i) => i.id === pause?.insightId);
      expect(insight?.facts.some((f) => f.metric === "spend")).toBe(true);
      expect(insight?.facts.some((f) => f.metric === "leads" && f.value === 0)).toBe(true);
    });
    And("в истории есть это решение с «Вернуть как было»", async () => {
      const pause = (await w.store.changes("b1")).find((c) => c.action.type === "PauseAd" && c.author === "service" && c.status === "applied");
      const change = (await w.work()).journal.flatMap((s) => s.entries).flatMap((e) => e.changes).find((c) => c.historyId === pause?.id);
      expect(change?.item?.rollback.kind).toBe("available");
    });
  });

  Scenario("Переходов больше, чем показов", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let error: unknown;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("владелец вносит у объявления 50 показов и 60 переходов", async () => {
      error = await w.enter(7, { [PLAIN]: { impressions: 50, clicks: 60, leads: 0, spendRub: 100 } }).catch((e: unknown) => e);
    });
    Then("период не проходит с пояснением «Переходов не может быть больше, чем показов», а статистики нет", async () => {
      expect(error).toMatchObject({ code: "PERIOD_INVALID", message: "Переходов не может быть больше, чем показов" });
      expect((await w.record()).steps).toEqual([]);
      expect(await w.store.stats("b1", "2026-10-01", "2027-01-31")).toEqual([]);
    });
  });

  Scenario("Расход сверх лимита", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let error: unknown;
    let room = 0;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("владелец вносит у объявлений направления больше, чем Директ потратил бы на него за 7 дней", async () => {
      room = (await w.form()).directions.find((d) => d.channel === "search")?.roomRub[7] ?? 0;
      error = await w.enter(7, { [BAD]: { impressions: 5_000, clicks: 300, leads: 0, spendRub: room }, [GOOD]: { impressions: 100, clicks: 10, leads: 0, spendRub: 1 } }).catch((e: unknown) => e);
    });
    Then("период не проходит, а пояснение называет, сколько Директ потратит на это направление за 7 дней", async () => {
      expect(room).toBeGreaterThan(0);
      expect(plain((error as Error).message)).toBe(`Директ потратит на это направление не больше ${plain(room.toLocaleString("ru-RU"))} ₽ за 7 дней`);
      expect((await w.record()).steps).toEqual([]);
    });
  });

  Scenario("Отключённого объявления нет в окне", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let form: Awaited<ReturnType<OwnerWorld["form"]>>;
    Given("в конце прошлого периода сервис отключил объявление без обращений", async () => {
      w = await ownerWorld(new IdlePolicy());
      await w.enter(7, { [BAD]: NO_LEADS, [GOOD]: CHEAP_LEADS });
      expect((await w.store.ads("b1")).find((a) => a.title === BAD)?.status).toBe("paused");
    });
    When("владелец открывает окно следующего периода", async () => {
      form = await w.form();
    });
    Then("отключённого объявления в окне нет, а все объявления, которые показываются, в нём есть", async () => {
      const ids = form.directions.flatMap((d) => d.ads.map((a) => a.id));
      const paused = (await w.store.ads("b1")).find((a) => a.title === BAD && a.status === "paused");
      expect(ids).not.toContain(paused?.id);
      const shown = (await w.record()).state.ads.filter((a) => a.status === "active" && a.moderation === "accepted");
      const byPlatform = new Map((await w.store.ads("b1")).map((a) => [a.platformAdId, a.id]));
      expect([...ids].sort()).toEqual(shown.map((a) => byPlatform.get(a.id)).sort());
    });
  });

  Scenario("Реклама изменилась, пока окно было открыто", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    let rows: Awaited<ReturnType<OwnerWorld["rowsOf"]>>;
    let error: unknown;
    Given("владелец открыл окно статистики", async () => {
      w = await ownerWorld();
      rows = await w.rowsOf({ [PLAIN]: { impressions: 100, clicks: 10, leads: 0, spendRub: 200 } });
    });
    When("в другой вкладке он отключает объявление, а затем отправляет цифры с ним", async () => {
      await handleWebJob(w.ctx, { kind: "command", businessId: "b1", command: { type: "PauseAd", adId: rows[0]?.adId ?? "" }, explanation: "Вы отключили объявление." });
      error = await handleWebJob(w.ctx, { kind: "simulation_control", businessId: "b1", control: { action: "period", days: 7, ads: rows } }).catch((e: unknown) => e);
    });
    Then("период не проходит, сервис говорит «Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты»", async () => {
      expect(error).toMatchObject({ code: "SIMULATION_ADS_CHANGED", message: "Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты" });
      expect((await w.record()).steps).toEqual([]);
    });
    And("окно, открытое снова, показывает только объявления, которые показываются сейчас", async () => {
      expect((await w.form()).directions.flatMap((d) => d.ads.map((a) => a.id))).not.toContain(rows[0]?.adId);
    });
  });

  Scenario("Окно открывается на одном дне", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    let day = 0;
    Given("реклама запущена в симуляции и дошла до 9-го дня", async () => {
      w = await ownerWorld();
      await w.enter(7);
      await w.enter(1);
      day = (await w.player()).day;
      expect(day).toBe(9);
    });
    When("владелец нажимает «Добавить статистику»", () => undefined);
    Then("выбран «1 день», а заголовок окна — «Статистика за день 9»", () => {
      expect(DEFAULT_PERIOD_DAYS).toBe(1);
      expect(`Статистика за ${periodDaysText({ from: day, to: day + DEFAULT_PERIOD_DAYS - 1 })}`).toBe("Статистика за день 9");
    });
    And("окно ничего не спрашивает о рынке: разбивка следующего периода — по обычным утечкам учебного рынка", async () => {
      expect((await w.form()).market).toEqual(MARKET);
    });
  });

  Scenario("Один день", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции и дошла до 9-го дня", async () => {
      w = await ownerWorld();
      await w.enter(7);
      await w.enter(1);
      expect((await w.player()).day).toBe(9);
    });
    When("владелец вносит статистику за «1 день»", async () => {
      await w.enter(1, { [GOOD]: { impressions: 200, clicks: 10, leads: 1, spendRub: 150 } });
    });
    Then("разбор называется «Разбор дня · день 9», а плеер говорит «День 10»", async () => {
      expect((await w.player()).day).toBe(10);
      const review = serviceEntries((await sectionOf(w, "2026-11-09"))?.entries).find((e) => e.period !== undefined);
      expect(review && noteTitle(review, words)).toBe("Разбор дня · день 9");
    });
  });

  Scenario("Пустые поля — нули", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("владелец отправляет окно, ничего не вписав", async () => {
      await w.enter(7);
    });
    Then("период проходит с нулевой статистикой, сервис разбирает его, а расход и обращения не меняются", async () => {
      expect((await w.record()).steps).toMatchObject([{ kind: "period", state: "completed" }]);
      expect((await w.store.turns("b1")).map((t) => t.trigger)).toEqual(["period_review"]);
      expect((await w.store.stats("b1", "2026-10-01", "2027-01-31")).reduce((s, r) => s + r.spend + r.leads, 0)).toBe(0);
    });
  });

  Scenario("Заполнить примерно", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    let form: Awaited<ReturnType<OwnerWorld["form"]>>;
    let rows: ReturnType<typeof suggestPeriod> = [];
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("владелец открывает окно недели и нажимает «Заполнить примерно»", async () => {
      form = await w.form();
      rows = suggestPeriod(form, 7);
    });
    Then("у каждого объявления заполнены четыре поля, которые окно принимает, расход каждого направления не больше того, что Директ потратил бы за 7 дней", () => {
      expect(rows.map((r) => r.adId).sort()).toEqual(form.directions.flatMap((d) => d.ads.map((a) => a.id)).sort());
      expect(rows.every((r) => r.impressions >= r.clicks && r.clicks >= r.leads && r.clicks > 0 && r.spendRub > 0)).toBe(true);
      expect(checkPeriod(form, 7, rows)).toEqual({ errors: [], changed: false });
      for (const direction of form.directions) {
        const ids = new Set(direction.ads.map((a) => a.id));
        expect(rows.filter((r) => ids.has(r.adId)).reduce((s, r) => s + r.spendRub, 0)).toBeLessThanOrEqual(direction.roomRub[7]);
      }
    });
    And("ничего не отправлено, пока владелец не нажмёт «Отправить сервису»", async () => {
      expect((await w.record()).steps).toEqual([]);
      expect(await w.store.stats("b1", "2026-10-01", "2027-01-31")).toEqual([]);
    });
  });

  Scenario("Цифры продолжают прошлый период", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let rows: ReturnType<typeof suggestPeriod> = [];
    let ids: Record<string, string> = {};
    Given("в прошлом периоде одно объявление приводило обращения по 200 ₽, а другое не привело ни одного", async () => {
      w = await ownerWorld();
      ids = Object.fromEntries((await w.rowsOf({ [GOOD]: CHEAP_LEADS, [BAD]: CHEAP_LEADS })).map((r, i) => [i === 0 ? GOOD : BAD, r.adId]));
      await w.enter(7, { [GOOD]: { impressions: 1_000, clicks: 50, leads: 4, spendRub: 800 }, [BAD]: { impressions: 1_000, clicks: 40, leads: 0, spendRub: 600 } });
    });
    When("владелец нажимает «Заполнить примерно» в окне следующего периода", async () => {
      rows = suggestPeriod(await w.form(), 7);
    });
    Then("у первого цена обращения близка к прежней, а у второго обращений нет", () => {
      const good = rows.find((r) => r.adId === ids[GOOD]);
      const bad = rows.find((r) => r.adId === ids[BAD]);
      expect(good?.leads).toBeGreaterThan(0);
      const costPerLead = (good?.spendRub ?? 0) / (good?.leads ?? 1);
      expect(costPerLead).toBeGreaterThan(200 * 0.7);
      expect(costPerLead).toBeLessThan(200 * 1.4);
      expect(bad?.clicks).toBeGreaterThan(0);
      expect(bad?.leads).toBe(0);
    });
  });

  Scenario("Ненужный запрос в разбивке", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама в поиске с основным запросом «маникюр москва» запущена в симуляции с целью 1 000 ₽", async () => {
      w = await ownerWorld(new IdlePolicy(), ROOMY);
      expect((await w.form()).directions.find((d) => d.channel === "search")).toMatchObject({ keywords: ["маникюр москва"], junkQuery: JUNK_QUERY });
    });
    When("владелец вносит за неделю у объявления в поиске 4 200 ₽ расхода и 7 обращений, ничего не отмечая", async () => {
      await w.enter(7, { [PLAIN]: WEEK_4200 });
    });
    Then("разрез направления по запросам за эти дни показывает «маникюр москва фото» с расходом 1 050 ₽ без обращений, а сумма строк — 4 200 ₽ и 7 обращений", async () => {
      const queries = await w.breakdown("query", "2026-11-01", "2026-11-07");
      expect(queries.find((r) => r.segment === JUNK_QUERY)).toMatchObject({ leads: 0, spend: rubles(1_050) });
      expect(sumRows(queries)).toMatchObject({ leads: 7, spend: rubles(4_200) });
      // The agent's own tool sees the same row on the morning after the week.
      const seen = (await agentBreakdowns(w, { from: "2026-11-01", to: "2026-11-07" })).find((a) => a.dimension === "query");
      expect(seen?.rows.find((r) => r.segment === JUNK_QUERY)).toMatchObject({ spendRub: 1_050, leads: 0, verdict: "дороже цели" });
    });
  });

  Scenario("Сервис убирает ненужный запрос", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("реклама в поиске запущена в симуляции с целью 1 000 ₽ и тестовой политикой агента", async () => {
      w = await ownerWorld(new HeuristicPolicy(), ROOMY);
    });
    When("владелец вносит неделю: 4 200 ₽ расхода и 7 обращений", async () => {
      await w.enter(7, { [PLAIN]: WEEK_4200 });
    });
    Then("агент добавляет минус-фразу «фото», а разбор называет расход по запросу «маникюр москва фото» и ноль обращений", async () => {
      const change = (await decided(w)).find((c) => c.action.type === "AddNegativeKeywords");
      expect(change?.action).toMatchObject({ type: "AddNegativeKeywords", phrases: ["фото"] });
      expect(change?.explanation).toContain(`«${JUNK_QUERY}»`);
      const insight = (await w.store.insights("b1")).find((i) => i.id === change?.insightId);
      expect(insight?.facts.find((f) => f.metric === "spend" && f.object.includes(JUNK_QUERY))?.value).toBe(1_050);
      expect(insight?.facts.some((f) => f.metric === "leads" && f.value === 0 && f.object.includes(JUNK_QUERY))).toBe(true);
      expect((await w.store.turns("b1")).at(-1)?.summary).toContain(`убрал показы по запросу «${JUNK_QUERY}»`);
    });
    And("в истории есть запись о минус-фразе с «Вернуть как было»", async () => {
      const change = (await decided(w)).find((c) => c.action.type === "AddNegativeKeywords");
      const entry = (await w.work()).journal.flatMap((s) => s.entries).flatMap((e) => e.changes).find((c) => c.historyId === change?.id);
      expect(entry?.item?.rollback.kind).toBe("available");
    });
  });

  Scenario("После минус-фразы дешевле", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    let rows: ReturnType<typeof suggestPeriod> = [];
    let plainId = "";
    Given("сервис добавил минус-фразу «фото» после недели", async () => {
      w = await ownerWorld(new HeuristicPolicy(), ROOMY);
      plainId = (await w.rowsOf({ [PLAIN]: WEEK_4200 }))[0]?.adId ?? "";
      await w.enter(7, { [PLAIN]: WEEK_4200 });
      expect((await decided(w)).some((c) => c.action.type === "AddNegativeKeywords")).toBe(true);
    });
    When("владелец нажимает «Заполнить примерно»", async () => {
      rows = suggestPeriod(await w.form(), 7);
    });
    Then("подставленная цена обращения у объявления в поиске ниже, чем в прошлом периоде", () => {
      const row = rows.find((r) => r.adId === plainId);
      expect(row?.leads ?? 0).toBeGreaterThan(0);
      expect((row?.spendRub ?? 0) / (row?.leads ?? 1)).toBeLessThan(WEEK_4200.spendRub / WEEK_4200.leads);
    });
    And("в разбивке следующего периода запроса «маникюр москва фото» нет", async () => {
      await controlSimulation(w.ctx, "b1", { action: "period", days: 7, ads: rows });
      const queries = await w.breakdown("query", "2026-11-08", "2026-11-14");
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.find((r) => r.segment === JUNK_QUERY)).toBeUndefined();
    });
  });

  Scenario("С телефонов обращения дороже", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("реклама в поиске запущена в симуляции с целью 1 000 ₽", async () => {
      w = await ownerWorld(new IdlePolicy(), ROOMY);
    });
    When("владелец выбирает «2 недели» и вносит у объявления в поиске без корректировок 9 000 ₽ и 11 обращений", async () => {
      await w.enter(14, { [PLAIN]: { impressions: 3_000, clicks: 180, leads: 11, spendRub: 9_000 } });
    });
    Then("разрез по устройствам за эти дни показывает с телефонов 5 400 ₽ — 60% расхода", async () => {
      const devices = await w.breakdown("device", "2026-11-01", "2026-11-14");
      expect(devices.find((r) => r.segment === "mobile")?.spend).toBe(rubles(5_400));
      expect(sumRows(devices)).toMatchObject({ leads: 11, spend: rubles(9_000) });
    });
    And("цена обращения с телефонов в разрезе — в 1,5–3 раза выше, чем с компьютеров", async () => {
      const devices = await w.breakdown("device", "2026-11-01", "2026-11-14");
      const cpl = (segment: string) => {
        const row = devices.find((r) => r.segment === segment);
        return (row?.spend ?? 0) / Math.max(1, row?.leads ?? 0);
      };
      expect(cpl("mobile") / cpl("desktop")).toBeGreaterThanOrEqual(1.5);
      expect(cpl("mobile") / cpl("desktop")).toBeLessThanOrEqual(3);
    });
  });

  Scenario("Разбивка согласована с итогом", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама в поиске запущена в симуляции с целью 1 000 ₽", async () => {
      w = await ownerWorld(new IdlePolicy(), ROOMY);
    });
    When("владелец вносит неделю", async () => {
      await w.enter(7, { [PLAIN]: WEEK_4200, [GOOD]: { impressions: 600, clicks: 31, leads: 3, spendRub: 555 } });
    });
    Then("за каждый день периода сумма строк разреза по устройствам и по запросам равна статистике этого дня", async () => {
      const search = (await w.store.directions("b1")).find((d) => d.channel === "search");
      for (let i = 0; i < 7; i++) {
        const day = addDays("2026-11-01", i);
        const stats = sumRows((await w.store.stats("b1", day, day)).filter((r) => r.campaignId === search?.platformCampaignId));
        expect(stats.spend).toBeGreaterThan(0);
        expect(sumRows(await w.breakdown("device", day, day))).toEqual(stats);
        expect(sumRows(await w.breakdown("query", day, day))).toEqual(stats);
      }
    });
  });

  Scenario("Отметки от прежней страницы", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама в поиске запущена в симуляции с целью 1 000 ₽", async () => {
      w = await ownerWorld(new IdlePolicy(), ROOMY);
    });
    When("страница, открытая до обновления, отправляет неделю с отметкой «С телефонов обращаются хуже»", async () => {
      await w.enter(7, { [PLAIN]: WEEK_4200 }, PHONES);
    });
    Then("период проходит, а разбивка такая же, как у периода без отметки", async () => {
      expect((await w.player()).day).toBe(8);
      // The step is split on the training market, as a period sent without marks: the junk query is there.
      expect((await w.store.getSimulation("b1"))?.steps.at(-1)?.market).toEqual(MARKET);
      const queries = await w.breakdown("query", "2026-11-01", "2026-11-07");
      expect(queries.find((r) => r.segment === JUNK_QUERY)).toMatchObject({ leads: 0, spend: rubles(1_050) });
    });
  });

  Scenario("Агент не видит правду сценария", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let sent = "";
    Given("реклама запущена в симуляции, и владелец внёс две недели статистики", async () => {
      w = await ownerWorld();
      await w.week();
      await w.week();
    });
    When("автотест смотрит, что получил агент в своих ходах", async () => {
      sent = JSON.stringify((await w.store.turns("b1")).map((t) => t.context));
    });
    Then("в снимках только статистика, как её прислал бы Директ, без скрытой правды рынка", () => {
      expect(sent).not.toMatch(/"(cr|ctr|costPerClick|impressionsPerDay|truth|truths|cells|scenario|input)"/);
      expect(sent).toMatch(/"spend14Rub"/);
    });
  });

  Scenario("Письма не уходят", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    const sent: string[] = [];
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("у бизнеса появляется событие «Пополните баланс в Яндекс Директе»", async () => {
      await w.store.notify({ businessId: "b1", kind: "low_balance", message: "Пополните баланс в Яндекс Директе", at: REAL_START });
      const mailer: Mailer = { send: (mail) => Promise.resolve(void sent.push(mail.to)) };
      await deliverNotifications(w.ctx, mailer, createLogger());
    });
    Then("письмо не отправляется, а событие видно на сводке", async () => {
      expect(sent).toEqual([]);
      expect((await w.store.notifications("b1")).map((n) => n.message)).toContain("Пополните баланс в Яндекс Директе");
    });
  });

  Scenario("Время стоит между периодами", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let day = 0;
    Given("реклама запущена в симуляции, и владелец внёс неделю статистики", async () => {
      w = await ownerWorld();
      await w.week();
      day = (await w.player()).day;
    });
    When("владелец 10 минут ничего не нажимает", () => {
      w.clock.set(new Date(w.clock.now().getTime() + 600_000));
    });
    Then("виртуальное время не сдвинулось, и плеер показывает тот же день", async () => {
      expect((await w.player()).day).toBe(day);
      expect((await w.record()).status).toBe("paused");
    });
  });

  Scenario("Переход во время расчёта", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    const agent = new HeldAgent();
    let period: Promise<unknown> = Promise.resolve();
    Given("реклама запущена в симуляции, а агент разбирает период долго", async () => {
      w = await ownerWorld(agent);
      agent.armed = true;
    });
    When("владелец отправляет статистику за дни 1–7 и, пока сервис её разбирает, смотрит плеер и историю", async () => {
      period = w.enter(7, { [GOOD]: CHEAP_LEADS });
      await agent.started;
    });
    Then("плеер говорит, что сервис разбирает дни 1–7, день прежний, прожитых периодов нет, а в истории нет разбора этих дней", async () => {
      const player = await w.player();
      expect(player).toMatchObject({ day: 1, status: "stepping", periods: 0, agentTurn: true, step: { from: 1, to: 7 } });
      expect(periodReviewText(player.step ?? { from: 0, to: 0 })).toBe("Сервис разбирает дни 1–7…");
      expect((await w.work()).journal.filter((s) => s.period)).toEqual([]);
    });
    And("после хода период завершён, и в истории появляется его разбор", async () => {
      agent.finish();
      await period;
      expect(await w.player()).toMatchObject({ day: 8, status: "paused", periods: 1 });
      expect(serviceEntries((await sectionOf(w, "2026-11-01"))?.entries).some((e) => e.period !== undefined)).toBe(true);
    });
  });

  Scenario("Новый период при доступном прошлом", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    const agent = new HeldAgent();
    let period: Promise<unknown> = Promise.resolve();
    Given("реклама запущена в симуляции, владелец внёс первый период, а агент разбирает следующий долго", async () => {
      w = await ownerWorld(agent);
      await w.week();
      agent.armed = true;
    });
    When("владелец отправляет второй период", async () => {
      period = w.week();
      await agent.started;
    });
    Then("первый период доступен в истории с сохранённым разбором, а второй явно ещё разбирается", async () => {
      try {
        const simulation = await w.record();
        expect(simulation.steps.map((s) => s.state)).toEqual(["completed", "running"]);
        expect(simulation.steps[0]?.report).toBeDefined();
        expect((await w.work()).journal.filter((s) => s.period).map((s) => s.from)).toEqual(["2026-11-01"]);
        expect(await w.player()).toMatchObject({ status: "stepping", periods: 1, step: { from: 8, to: 14 } });
      } finally {
        agent.finish();
        await period;
      }
    });
  });

  Scenario("Сбой разбора", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("просмотр сервиса в конце периода прервался", async () => {
      w = await ownerWorld();
      const spy = vi.spyOn(w.store, "saveEvaluation").mockRejectedValueOnce(new Error("Injected evaluation failure"));
      await expect(w.enter(3, { [GOOD]: { impressions: 300, clicks: 20, leads: 1, spendRub: 400 } })).rejects.toThrow("Injected evaluation failure");
      spy.mockRestore();
      expect((await w.player()).failed).toBe(true);
    });
    When("владелец нажимает «Продолжить расчёт»", async () => {
      await controlSimulation(w.ctx, "b1", { action: "continue" });
    });
    Then("тот же период доводится до конца с теми же цифрами, без повторного ввода", async () => {
      expect((await w.record()).steps).toMatchObject([{ kind: "period", days: 3, state: "completed" }]);
      expect(await w.totals(GOOD)).toEqual({ impressions: 300, clicks: 20, leads: 1, spend: rubles(400) });
      expect((await w.player()).day).toBe(4);
    });
  });

  Scenario("Период с решением", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции с тестовой политикой агента", async () => {
      w = await ownerWorld(new HeuristicPolicy());
      await w.enter(7, FIRST_WEEK);
    });
    When("во втором периоде сервис отключает объявление без обращений", async () => {
      await w.enter(7, SECOND_WEEK);
      expect((await w.store.ads("b1")).some((a) => a.title === BAD && a.status === "paused")).toBe(true);
    });
    Then("раздел второго периода в истории — «Дни 8–14 · разбор в день 15», с разбором и строкой изменения с «Вернуть как было»", async () => {
      const section = await sectionOf(w, "2026-11-08");
      expect(section).toMatchObject({ from: "2026-11-08", to: "2026-11-14" });
      const review = serviceEntries(section?.entries).find((e) => e.period !== undefined);
      expect(review?.date).toBe("2026-11-15");
      expect(`${words.range(section?.from ?? "", section?.to ?? "")} · разбор ${words.on(review?.date ?? "")}`).toBe("дни 8–14 · разбор в день 15");
      expect(review && noteTitle(review, words)).toBe("Разбор · дни 8–14");
      const change = serviceEntries(section?.entries).flatMap((e) => e.changes).find((c) => c.text.includes(BAD));
      expect(change?.item?.rollback.kind).toBe("available");
    });
  });

  Scenario("Период без решений", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции", async () => {
      w = await ownerWorld();
    });
    When("владелец вносит неделю без расходов, и сервис ничего не меняет", async () => {
      await w.enter(7);
    });
    Then("раздел периода состоит из одной записи «посмотрел рекламу — менять ничего не нужно»", async () => {
      const entries = serviceEntries((await sectionOf(w, "2026-11-01"))?.entries).filter((e) => e.date === "2026-11-08");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.changes).toEqual([]);
    });
  });

  Scenario("Прошлый период снова", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let before: unknown;
    Given("реклама запущена в симуляции с тестовой политикой агента, и владелец внёс два периода", async () => {
      w = await ownerWorld(new HeuristicPolicy());
      await w.enter(7, FIRST_WEEK);
      await w.enter(7, SECOND_WEEK);
      before = serviceEntries((await sectionOf(w, "2026-11-08"))?.entries).map((e) => [e.headline, e.paragraphs, e.changes.map((c) => c.text)]);
      // The owner takes the service's pause back.
      const pause = (await w.store.changes("b1")).find((c) => c.action.type === "PauseAd" && c.author === "service" && c.status === "applied");
      expect(await handleWebJob(w.ctx, { kind: "rollback", businessId: "b1", entryId: pause?.id ?? "" })).toMatchObject({ kind: "done" });
    });
    When("владелец вносит ещё два периода и прокручивает историю ко второму", async () => {
      await w.week();
      await w.week();
    });
    Then("тексты второго периода прежние, а отменённые решения помечены «отменено»", async () => {
      const entries = serviceEntries((await sectionOf(w, "2026-11-08"))?.entries);
      expect(entries.map((e) => [e.headline, e.paragraphs, e.changes.map((c) => c.text)])).toEqual(before);
      expect(entries.flatMap((e) => e.changes).some((c) => c.reverted)).toBe(true);
    });
  });

  Scenario("Цель изменилась после периода", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let report: string | undefined;
    Given("реклама запущена в симуляции, и владелец внёс первый период", async () => {
      w = await ownerWorld();
      await w.week();
      report = (await w.record()).steps[0]?.report;
    });
    When("владелец меняет цель и вносит ещё два периода", async () => {
      await w.store.saveBusiness({ ...(await w.store.getBusiness("b1")), csoSource: { kind: "user", goal: rubles(300) } });
      await w.week();
      await w.week();
    });
    Then("сохранённый итог первого периода прежний", async () => {
      expect(report).toBeDefined();
      expect((await w.record()).steps[0]?.report).toBe(report);
    });
  });

  Scenario("Начать заново", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    let titles: string[] = [];
    Given("реклама запущена в симуляции, и владелец внёс два периода", async () => {
      w = await ownerWorld();
      titles = (await w.store.ads("b1")).map((a) => a.title).sort();
      await w.week();
      await w.week();
    });
    When("владелец нажимает «Начать заново»", async () => {
      await controlSimulation(w.ctx, "b1", { action: "restart" });
    });
    Then("цифры и история удалены, а реклама начинается с первого дня с теми же объявлениями", async () => {
      expect(await w.store.stats("b1", "2026-10-01", "2027-01-31")).toEqual([]);
      expect((await w.store.changes("b1")).map((c) => c.explanation)).toEqual([expect.stringMatching(/^Реклама запущена/) as unknown]);
      expect(await w.player()).toMatchObject({ day: 1, periods: 0 });
      expect((await w.store.ads("b1")).map((a) => a.title).sort()).toEqual(titles);
    });
  });

  Scenario("Прежняя страница", ({ Given, When, Then }) => {
    const answers: unknown[] = [];
    Given("страница симуляции открыта до обновления", () => undefined);
    When("она отправляет «Прожить неделю», «+1 день», «Повторить этот прогон» или «Запустить по-настоящему»", () => {
      for (const body of [{ action: "step_week" }, { action: "step_day" }, { action: "restart", mode: "repeat" }, { action: "go_real" }]) answers.push(currentAction(SimulationControlBody.parse(body)));
    });
    Then("сервис не выполняет действие и просит обновить страницу", () => {
      // The web route answers such an action «Пульт симуляции обновился — обновите страницу» and enqueues nothing.
      expect(answers).toEqual([null, null, null, null]);
    });
  });

  Scenario("Новая кампания", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    Given("реклама запущена в симуляции, и владелец внёс неделю статистики", async () => {
      w = await ownerWorld();
      await w.week();
    });
    When("владелец выбирает в меню плеера «Новая кампания» и подтверждает", async () => {
      await controlSimulation(w.ctx, "b1", { action: "new_campaign" });
    });
    Then("цифры, история и объявления симуляции удалены вместе с описанием бизнеса и бюджетом", async () => {
      expect(await w.store.getSimulation("b1")).toBeNull();
      expect(await w.store.directions("b1")).toEqual([]);
      expect(await w.store.ads("b1")).toEqual([]);
      expect(await w.store.changes("b1")).toEqual([]);
      expect(await w.store.insights("b1")).toEqual([]);
      expect(await w.store.stats("b1", "2026-10-01", "2027-01-31")).toEqual([]);
      expect(await w.store.getBusiness("b1")).toMatchObject({ card: {}, monthlyBudgetRub: 0, csoSource: { kind: "auto", reference: 0 }, miniSite: null });
    });
    And("мастер открыт на первом шаге с пустыми полями, а запуск из него у демо снова будет симуляцией", async () => {
      // The wizard opens on step 1 for a business not launched, with an empty draft for an empty card (web); the next
      // launch takes the account's mode, not the business's stored one.
      expect(await w.store.getBusiness("b1")).toMatchObject({ launchedOn: null });
      expect(launchModeFor("demo", {})).toEqual({ ok: true, mode: "simulation" });
    });
  });

  Scenario("Без настоящего запуска", ({ Given, When, Then, And }) => {
    let w: OwnerWorld;
    let menu: { action: string; label: string }[] = [];
    Given("реклама демо запущена в симуляции, и владелец внёс неделю статистики", async () => {
      w = await ownerWorld();
      await w.week();
    });
    When("владелец открывает меню плеера", () => {
      menu = [...PLAYER_MENU];
    });
    Then("в меню два действия — «Начать заново» и «Новая кампания», и оба принимаются сервисом", () => {
      expect(menu.map((item) => item.label)).toEqual(["Начать заново", "Новая кампания"]);
      for (const item of menu) expect(currentAction(SimulationControlBody.parse({ action: item.action }))).toEqual({ action: item.action });
    });
    And("«Запустить по-настоящему» нет, а данные симуляции остаются на месте", async () => {
      expect(menu.map((item) => item.label)).not.toContain("Запустить по-настоящему");
      expect(currentAction(SimulationControlBody.parse({ action: "go_real" }))).toBeNull();
      expect(await w.store.getSimulation("b1")).not.toBeNull();
      expect((await w.store.getBusiness("b1")).mode).toBe("simulation");
    });
  });
});
