import { HeuristicPolicy, IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, handleWebJob } from "@impuls/worker";
import type { JobContext, LaunchPlan } from "@impuls/worker";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/onboarding";
import { feedDays } from "@/lib/insights-model";
import { buildDecisionScreen, scenarioTruth } from "@/lib/simulation-screen";
import type { SimulationStatus } from "@/lib/simulation-model";
import { DecisionsView } from "./simulation/DecisionsView";
import { SimulationBar } from "./SimulationBar";
import { ModeChoice, ScenarioPicker } from "./wizard/SimulationChoice";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary" }));

const plan: LaunchPlan = {
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 2_100, keywords: ["маникюр"], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Маникюр ${i}`, text: "У метро" })) },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_400, keywords: [], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Ноготок ${i}`, text: "Запись онлайн" })) },
  ],
};

/** A 30-day run of «Одно объявление не приносит клиентов» on the worker, in memory, with the rules or the agent. */
const run = async (rollBackOne: boolean, agent: AgentRuntime = new IdlePolicy()) => {
  const store = new MemoryStore();
  await store.saveBusiness({
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: 15_000,
    launchedOn: null,
    csoSource: { kind: "auto", reference: rubles(500) },
    miniSite: null,
    leadGoalId: null,
    mode: "direct",
    card: { category: "Маникюр", services: [], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
  });
  const clock = new ManualClock(new Date("2026-11-03T07:00:00Z"));
  const locks = new MemoryLockManager();
  const platformFor = () => {
    throw new Error("no Direct in a simulation");
  };
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine() };
  await launchSimulation(ctx, "b1", plan, "dead_ad");
  for (let day = 0; day < 30; day++) await controlSimulation(ctx, "b1", { action: "step_day" });
  if (rollBackOne) {
    // The owner changes the show hours and takes it back; the worker routes both into the simulated world.
    const direction = (await store.directions("b1"))[0];
    await handleWebJob(ctx, { kind: "command", businessId: "b1", command: { type: "UpdateSchedule", directionId: direction?.id ?? "", schedule: "Пн–Вс 10:00–21:00" }, explanation: "Вы изменили время показа." });
    const result = (await handleWebJob(ctx, { kind: "rollback", businessId: "b1", entryId: (await store.changes("b1")).at(-1)?.id ?? "" })) as { kind: string };
    expect(result.kind).toBe("done");
  }
  const simulation = await store.getSimulation("b1");
  if (!simulation) throw new Error("no simulation");
  const ads = await store.ads("b1");
  const truthOf = scenarioTruth({ simulation, ads, goal: rubles(500) });
  const model = buildDecisionScreen({ simulation, timeZone: "Europe/Moscow", monthlyBudgetRub: 15_000, directions: await store.directions("b1"), changes: await store.changes("b1") });
  const days = feedDays({ insights: await store.insights("b1"), turns: await store.turnDigests("b1"), timeZone: "Europe/Moscow", since: null, entries: new Map(), truthOf });
  return { ...model, feed: { timeZone: "Europe/Moscow", check: null, days, names: { directions: {}, channels: {}, ads: {}, strategies: {} } }, ads, truthOf };
};

describe("decisions screen model (simulation-mode spec)", () => {
  it("compares with the run without the service and ticks the checklist with history links", async () => {
    const model = await run(false);
    expect(model.day).toBe(30);
    // The scenario's items, the rollback and the budget; the cabinet item is not this scenario's and was not done.
    expect(model.checklist.map((c) => c.key)).toEqual(expect.arrayContaining(["pause", "scale", "rollback", "budget"]));
    expect(model.checklist.some((c) => c.key === "cabinet")).toBe(false);
    // With and without the service, day by day, for every day of the scenario.
    expect(model.comparison?.service).toHaveLength(30);
    expect(model.comparison?.baseline).toHaveLength(30);
    expect(model.comparison?.serviceNow.leads).toBe(model.result?.service.leads);
    expect(model.comparison?.baselineNow.leads).toBe(model.result?.baseline.leads);
    const item = (key: string) => model.checklist.find((c) => c.key === key);
    expect(item("pause")).toMatchObject({ done: true });
    expect(item("pause")?.entryId).toBeTruthy();
    expect(item("scale")).toMatchObject({ done: true });
    expect(item("budget")).toMatchObject({ done: true });
    expect(item("rollback")).toMatchObject({ done: false, hint: "Откатите любое изменение в истории или в ленте — кнопка «Вернуть как было»" });
    expect(model.decisionDays.length).toBeGreaterThan(0);
    expect(model.result?.days).toBe(30);
    expect(model.result?.service.spend).toBeGreaterThan(0);
  }, 60_000);

  it("ticks «откат работает» after the owner rolls a change back", async () => {
    const model = await run(true);
    expect(model.checklist.find((c) => c.key === "rollback")).toMatchObject({ done: true, hint: null });
  }, 60_000);

  it("says what is true about the insight's ad or advertising, against the goal", async () => {
    const model = await run(false);
    const dead = model.ads.find((a) => a.title === "Маникюр 1");
    expect(model.truthOf({ kind: "ad", id: dead?.id ?? "" })).toEqual({ text: "На самом деле: объявление не приводит обращений", tone: "danger" });
    const good = model.ads.find((a) => a.title === "Маникюр 2");
    expect(model.truthOf({ kind: "ad", id: good?.id ?? "" })?.text.replace(/\u00a0/g, " ")).toMatch(/^На самом деле: обращение примерно за \d[\d ]* ₽ — (в пределах|дороже) цели 500 ₽$/);
  }, 60_000);

  it("ticks the checklist by the agent's decisions too, and shows its insights with the truth", async () => {
    const model = await run(false, new HeuristicPolicy());
    expect(model.checklist.find((c) => c.key === "pause")).toMatchObject({ done: true });
    const insights = model.feed.days.flatMap((d) => d.insights);
    expect(insights.some((i) => i.author === "agent")).toBe(true);
    const pause = insights.find((i) => i.decision.text === "Отключили объявление «Маникюр 1»");
    expect(pause?.truth?.text).toBe("На самом деле: объявление не приводит обращений");
    // A change the guard refused is not tried again day after day.
    const refused = insights.filter((i) => i.decision.status === "rejected").map((i) => i.decision.text);
    expect(new Set(refused).size).toBe(refused.length);
    expect(model.feed.days.some((d) => d.summary !== null || d.quiet)).toBe(true);
  }, 60_000);

  it("renders the comparison, the checklist and the feed in plain words, without the old ribbons and budget chart", async () => {
    render(<DecisionsView model={await run(false, new HeuristicPolicy())} />);
    expect(screen.getByText("Отключил рекламу, которая не приносит клиентов")).toBeTruthy();
    expect(screen.getAllByTestId("insight-truth").some((n) => n.textContent?.includes("не приводит обращений"))).toBe(true);
    expect(screen.getByTestId("sim-comparison").textContent).toContain("Если бы сервис ничего не делал");
    expect(screen.getByTestId("sim-result").textContent).toContain("Если бы сервис ничего не делал");
    expect(screen.queryByTestId("sim-lane")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Лента месяца|Расходы против бюджета/);
    expect(document.body.textContent).not.toMatch(/CTR|конверси|ставк|CPC|CPA/i);
  }, 60_000);
});

describe("step 6 choice", () => {
  it("offers the simulation and explains why a scenario does not fit", () => {
    const onChange = vi.fn();
    render(<ModeChoice mode="direct" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Симуляция"));
    expect(onChange).toHaveBeenCalledWith("simulation");

    const draft = emptyDraft();
    draft.budget.monthlyBudgetRub = 15_000;
    draft.ads = { search: [{ title: "Маникюр", text: "У метро" }], network: [] };
    const onEdit = vi.fn();
    render(<ScenarioPicker draft={draft} scenario="regular" onChange={() => undefined} onEdit={onEdit} />);
    // «Обычный месяц» first, the others under «Другие сценарии».
    expect(screen.getByLabelText("Обычный месяц")).toBeChecked();
    expect(screen.queryByLabelText("Пограничное объявление")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Другие сценарии/ }));
    expect(screen.getByText("Нужно хотя бы 2 объявления в поиске — сейчас 1")).toBeTruthy();
    expect(screen.getByLabelText("Одно объявление не приносит клиентов")).toBeDisabled();
    expect(screen.getByLabelText("Пограничное объявление")).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Добавить объявление" }));
    expect(onEdit).toHaveBeenCalledWith(5);
  });
});

describe("simulation pult", () => {
  const status: SimulationStatus = {
    day: 9,
    totalDays: 30,
    at: "2026-11-11T11:00:00Z",
    timeZone: "Europe/Moscow",
    status: "running",
    speed: "fast",
    ended: false,
    changes: 12,
    lastDecision: null,
    agentTurn: null,
  };

  it("shows the virtual day and the controls", () => {
    render(<SimulationBar initial={status} />);
    expect(screen.getByTestId("simulation-day").textContent).toBe("День 9 из 30 · 14:00");
    // The speed is on the pult, not only in the menu: a slow day must not look like a stuck one.
    expect(screen.getByTestId("simulation-speed").textContent).toBe("1 день = 10 с");
    expect(screen.getByText(/Симуляция — реклама не показывается/)).toBeTruthy();
    // Restart is a control of its own, not a hidden menu item.
    for (const name of [/Пауза/, /\+1 день/, /До следующего решения/, /Начать заново/]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // The rare actions stay in the labelled menu: the speed and «Запустить по-настоящему».
    fireEvent.click(screen.getByRole("button", { name: /Ещё/ }));
    for (const text of ["1 день = 10 секунд", "1 день = 1 минута", "Запустить по-настоящему"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("shows that the agent is reviewing the day while the time stands", () => {
    render(<SimulationBar initial={{ ...status, agentTurn: { day: 8 } }} />);
    expect(screen.getByTestId("simulation-agent-turn").textContent).toBe("Агент разбирает 8-й день…");
  });

  it("warns before «Начать заново» that the agent may decide otherwise", async () => {
    render(<SimulationBar initial={status} />);
    fireEvent.click(screen.getByRole("button", { name: "Начать заново" }));
    expect(await screen.findByText(/рынок будет тем же, но агент может решить иначе/)).toBeTruthy();
  });

  it("offers to continue for 30 more days at the end", () => {
    render(<SimulationBar initial={{ ...status, day: 30, status: "paused", ended: true }} />);
    expect(screen.getByRole("button", { name: "Продолжить ещё 30 дней" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\+1 день/ })).toBeNull();
  });
});
