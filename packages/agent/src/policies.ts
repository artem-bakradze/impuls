import { addDays, createRng, daysBetween, factKey, phraseMatches, phraseWords } from "@impuls/core";
import type { Command, InsightDraft } from "@impuls/core";
import type { AgentRuntime, AgentToolbox, BreakdownAnswer, BreakdownRowView, ToolCallRecord, TurnResult, TurnSnapshot, TurnTrigger } from "./runtime";

/** An insight on two facts every snapshot has (goal and budget), without numbers in the texts. */
const plainInsight = (reasonCode: string, observation: string): InsightDraft => ({
  reasonCode,
  observation,
  factKeys: [factKey.goal(), factKey.budget("budget_left")],
  next: "Проверим на следующем разборе.",
});

const run = async (tools: AgentToolbox, commands: { command: Command; insight: InsightDraft }[]): Promise<TurnResult> => {
  const calls: ToolCallRecord[] = [];
  for (const { command, insight } of commands) {
    calls.push({ command, insight, result: await tools.act(command, insight) });
  }
  return { summary: "Посмотрел рекламу.", calls, usage: null };
};

/** An agent that takes its turns and changes nothing: for tests of when turns run. */
export class QuietPolicy implements AgentRuntime {
  readonly name = "policy:quiet";
  readonly instructionsVersion = "test";
  readonly decides = true;
  runTurn(): Promise<TurnResult> {
    return Promise.resolve({ summary: "Посмотрели рекламу.", calls: [], usage: null });
  }
}

/** Does nothing and decides nothing, so no turns are run for it: proves the safety net alone keeps the guarantees. */
export class IdlePolicy implements AgentRuntime {
  readonly name = "policy:idle";
  readonly instructionsVersion = "test";
  readonly decides = false;
  runTurn(): Promise<TurnResult> {
    return Promise.resolve({ summary: "idle", calls: [], usage: null });
  }
}

/** Tries to overspend, bypass guards and act on foreign objects every turn. */
export class AdversarialPolicy implements AgentRuntime {
  readonly name = "policy:adversarial";
  readonly instructionsVersion = "test";
  readonly decides = true;
  runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    const commands: { command: Command; insight: InsightDraft }[] = [];
    for (const direction of input.snapshot.directions) {
      commands.push({ command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: direction.weeklyLimitRub * 100 * 10 }, insight: plainInsight("ADVERSARIAL_SCALE", "Увеличил лимит.") });
      if (direction.status === "paused") {
        commands.push({ command: { type: "ResumeDirection", directionId: direction.id }, insight: plainInsight("ADVERSARIAL_RESUME", "Включил направление.") });
      }
      commands.push({ command: { type: "SetStrategy", directionId: direction.id, strategyId: "NO_LIMIT_STRATEGY" }, insight: plainInsight("ADVERSARIAL_STRATEGY", "Сменил стратегию.") });
    }
    for (const decision of input.snapshot.userDecisions) {
      if (decision.action === "PauseAd") {
        commands.push({ command: { type: "PauseAd", adId: decision.objectId }, insight: plainInsight("ADVERSARIAL_REPEAT", "Снова отключил объявление.") });
      }
    }
    commands.push({ command: { type: "PauseAd", adId: "foreign-ad" }, insight: plainInsight("ADVERSARIAL_FOREIGN", "Отключил объявление.") });
    commands.push({ command: { type: "ResumeAll" }, insight: plainInsight("ADVERSARIAL_RESUME_ALL", "Включил всё.") });
    return run(input.tools, commands);
  }
}

/** Random actions with a fixed seed: fuzzes the guards. */
export class RandomPolicy implements AgentRuntime {
  readonly name = "policy:random";
  readonly instructionsVersion = "test";
  readonly decides = true;
  private readonly rng: () => number;
  constructor(seed: number) {
    this.rng = createRng(seed);
  }
  runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    const commands: { command: Command; insight: InsightDraft }[] = [];
    const pick = <T>(items: readonly T[]): T | undefined => items[Math.floor(this.rng() * items.length)];
    for (let i = 0; i < 3; i++) {
      const direction = pick(input.snapshot.directions);
      const ad = pick(input.snapshot.ads);
      const roll = this.rng();
      if (direction && roll < 0.4) {
        const factor = 0.5 + this.rng() * 2;
        commands.push({
          command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: Math.round(direction.weeklyLimitRub * factor) * 100 },
          insight: plainInsight("RANDOM_LIMIT", "Изменил лимит."),
        });
      } else if (ad && roll < 0.7) {
        commands.push({ command: { type: ad.status === "active" ? "PauseAd" : "ResumeAd", adId: ad.id }, insight: plainInsight("RANDOM_AD", "Изменил объявление.") });
      } else if (direction) {
        commands.push({
          command: { type: direction.status === "active" ? "PauseDirection" : "ResumeDirection", directionId: direction.id },
          insight: plainInsight("RANDOM_DIRECTION", "Изменил направление."),
        });
      }
    }
    return run(input.tools, commands);
  }
}

const SCALE_STEP = 1.2;
const SCALE_UTILIZATION = 0.9;
const EXPENSIVE = "дороже цели";
const WITHIN = "в цели";
/** The heuristic's adjustment step and floor, inside the guard's ±50 and 25 points (optimization-engine spec). */
const DEVICE_STEP = 25;
const DEVICE_FLOOR = -50;
const DEVICE_PAUSE_DAYS = 7;
/**
 * A device is cut only when it is clearly dearer: at the other device's cost per lead its spend would have brought at
 * least 8 leads, and it brought a third of that or less (by chance, with equal devices, about 1 time in 100).
 */
const DEVICE_EXPECTED_LEADS = 8;
const DEVICE_GAP = 3;
const DEVICE_MIN_LEADS = 3;
const HYPOTHESIS_CHECK_DAYS = 7;

const key = (row: BreakdownRowView, metric: string): string => `${row.factKeyPrefix}:${metric}:14d`;

/** A word of the query that none of the direction's own phrases has: what tells the junk query apart. */
const negativeWordOf = (query: string, keywords: readonly string[]): string | null => {
  const own = new Set(keywords.flatMap(phraseWords));
  return phraseWords(query).find((w) => w.length >= 3 && !own.has(w) && !/^\d+$/.test(w)) ?? null;
};
/** A refused action is not tried again for this long: the reason (the month's budget, the step limit) rarely changes sooner. */
const RETRY_AFTER_MS = 3 * 86_400_000;

/**
 * A deterministic agent for tests, e2e and a free stand: decides like the rules, but through the agent tools and
 * with insights on the snapshot's facts. Stateless, so a simulation with it repeats exactly.
 */
export class HeuristicPolicy implements AgentRuntime {
  readonly name = "policy:heuristic";
  readonly instructionsVersion = "test";
  readonly decides = true;

  async runTurn(input: { trigger?: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    const { snapshot, tools } = input;
    if (input.trigger?.kind === "weekly_review") {
      return this.weeklyReview(snapshot, tools);
    }
    const keys = new Set(snapshot.facts.map((f) => f.key));
    const goal = factKey.goal();
    const calls: ToolCallRecord[] = [];
    const done: string[] = [];
    const act = async (command: Command, insight: InsightDraft, what: string) => {
      const result = await tools.act(command, insight);
      calls.push({ command, insight, result });
      if (result.status !== "rejected") done.push(what);
    };
    const recent = await tools.recentInsights();
    const now = Date.parse(`${snapshot.today}T12:00:00Z`);
    /** The guard refused the same change of this object lately: the owner would only see the refusal again. */
    const refusedLately = (object: string | undefined) =>
      recent.some((r) => r.decision.includes("— отклонено:") && now - Date.parse(r.at) < RETRY_AFTER_MS && r.facts.some((f) => f.metric === "weekly_limit" && f.object === object));

    for (const ad of snapshot.ads.filter((a) => a.status === "active" && a.class === "ineffective")) {
      const siblings = snapshot.ads.filter((a) => a.directionId === ad.directionId && a.status === "active");
      if (siblings.length < 2) continue;
      await act(
        { type: "PauseAd", adId: ad.id },
        {
          reasonCode: "PAUSE_INEFFECTIVE",
          observation: `Объявление «${ad.title}» за 14 дней потратило ${ad.spend14Rub} ₽ и привело обращений: ${ad.leads14}. Это дороже цели.`,
          factKeys: [factKey.ad(ad.id, "spend", "14d"), factKey.ad(ad.id, "leads", "14d"), goal],
          next: "Деньги перейдут к объявлениям, которые приводят обращения, — через неделю сравню цену обращения этой рекламы с целью.",
        },
        "отключил объявление, которое не приводит клиентов",
      );
    }

    for (const direction of snapshot.directions.filter((d) => d.status === "active" && d.class === "effective" && d.spend7Rub >= d.weeklyLimitRub * SCALE_UTILIZATION)) {
      const cpl = factKey.direction(direction.id, "cost_per_lead", "14d");
      const limit = factKey.direction(direction.id, "weekly_limit", "now");
      if (!keys.has(cpl) || refusedLately(snapshot.facts.find((f) => f.key === limit)?.object)) continue;
      await act(
        { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: Math.floor(direction.weeklyLimitRub * SCALE_STEP) * 100 },
        {
          reasonCode: "SCALE_EFFECTIVE",
          observation: "Эта реклама приводит клиентов дешевле цели и тратит почти весь недельный лимит.",
          factKeys: [cpl, goal, factKey.direction(direction.id, "spend", "7d"), limit],
          next: "Жду больше обращений по цене не выше цели — через неделю проверю их число.",
        },
        "добавил денег рекламе, которая приводит клиентов дешевле цели",
      );
    }

    if (snapshot.experiment === null) {
      const borderline = snapshot.ads.find((a) => a.status === "active" && a.class === "borderline");
      if (borderline) {
        await act(
          { type: "StartExperiment", directionId: borderline.directionId, adId: borderline.id, kind: "offer", hypothesis: "" },
          {
            reasonCode: "START_AB",
            observation: `Объявление «${borderline.title}» приводит клиентов примерно по цене цели — непонятно, стоит ли его оставлять.`,
            factKeys: [factKey.ad(borderline.id, "spend", "14d"), factKey.ad(borderline.id, "leads", "14d"), goal],
            next: "Жду, что один из вариантов текста будет приводить обращения дешевле, — проверю не меньше недели и оставлю его.",
          },
          "начал проверку нового варианта объявления",
        );
      }
    }

    await this.analystLevers(snapshot, tools, act);

    if (calls.length === 0) {
      const search = factKey.channel("search", "cost_per_lead", "14d");
      const network = factKey.channel("network", "cost_per_lead", "14d");
      if (keys.has(search) && keys.has(network) && !recent.some((r) => r.observation.startsWith("Сравнили площадки"))) {
        const observation = { reasonCode: "CHANNELS_COMPARED", observation: "Сравнили площадки по цене обращения за 14 дней.", factKeys: [search, network, goal], next: "Вернёмся к сравнению через неделю, когда данных станет больше.", decision: "Пока ничего не меняем: обеим площадкам нужно больше обращений для надёжного вывода." };
        calls.push({ command: null, insight: observation, result: await tools.observe(observation) });
      }
    }
    const summary = done.length > 0 ? `Разобрал рекламу: ${done.join(", ")}.` : "Посмотрел рекламу — менять ничего не нужно.";
    return { summary, calls, usage: null };
  }

  /**
   * The analyst levers by the service's verdicts (add-agent-analyst-stage1): junk queries and an expensive device. Run
   * on the daily turns and on Monday's review, as the instructions say. Advertising that is still collecting data is
   * left alone, as the instructions say of the «learning» class.
   */
  private async analystLevers(snapshot: TurnSnapshot, tools: AgentToolbox, act: (command: Command, insight: InsightDraft, what: string) => Promise<void>): Promise<void> {
    const goal = factKey.goal();
    for (const direction of snapshot.directions.filter((d) => d.status === "active" && d.class !== "learning" && d.spend14Rub > 0)) {
      const queries = await tools.breakdown(direction.id, "query");
      if (queries.status === "ok") {
        const phrases = this.junkPhrases(queries);
        for (const { phrase, row } of phrases) {
          await act(
            { type: "AddNegativeKeywords", directionId: direction.id, phrases: [phrase] },
            {
              reasonCode: "NEGATIVE_JUNK_QUERY",
              observation:
                row.leads === 0
                  ? `По запросу «${row.segment}» за 14 дней потратили ${row.spendRub} ₽ и не получили ни одного обращения.`
                  : `Запрос «${row.segment}» приводит клиентов дороже цели.`,
              factKeys: [key(row, "spend"), key(row, "leads"), goal],
              next: "Деньги перестанут уходить на этот запрос, и обращение должно подешеветь — через неделю проверю.",
            },
            `убрал показы по запросу «${row.segment}»`,
          );
        }
      }
      const devices = await tools.breakdown(direction.id, "device");
      if (devices.status === "ok") {
        const change = this.deviceChange(devices, snapshot.today);
        if (change) {
          const { device, expensive, other, percent, step } = change;
          const from = device === "mobile" ? "с телефонов" : "с компьютеров";
          await act(
            { type: "SetDeviceAdjustment", directionId: direction.id, device, percent },
            {
              reasonCode: "DEVICE_EXPENSIVE",
              observation: `Обращение ${from} обходится дороже цели, а с других устройств укладывается в цель. Снижаем цену перехода ${from} на ${step}%.`,
              factKeys: [key(expensive, expensive.costPerLeadRub === null ? "spend" : "cost_per_lead"), key(other, "cost_per_lead"), goal],
              next: `Жду, что обращения ${from} подешевеют, а деньги перейдут к устройствам, где обращение укладывается в цель, — через неделю сравню цену обращения по устройствам.`,
            },
            `снизил цену перехода ${from}`,
          );
        }
      }
    }
  }

  /** Queries «дороже цели» not cut yet, each with a word that is not in the direction's own phrases. */
  private junkPhrases(answer: Extract<BreakdownAnswer, { status: "ok" }>): { phrase: string; row: BreakdownRowView }[] {
    const negatives = answer.negativeKeywords ?? [];
    const result: { phrase: string; row: BreakdownRowView }[] = [];
    for (const row of answer.rows.filter((r) => r.verdict === EXPENSIVE)) {
      if (negatives.some((n) => phraseMatches(n, row.segment))) continue;
      const phrase = negativeWordOf(row.segment, answer.keywords ?? []);
      if (phrase !== null && !result.some((r) => r.phrase === phrase)) result.push({ phrase, row });
    }
    return result;
  }

  /**
   * One device «дороже цели» and clearly dearer per lead than the other, which is «в цели» on a few leads: its price per
   * click goes down a step, once in 7 days.
   */
  private deviceChange(answer: Extract<BreakdownAnswer, { status: "ok" }>, today: string) {
    const phones = answer.rows.find((r) => r.factKeyPrefix.endsWith(":mobile"));
    const computers = answer.rows.find((r) => r.factKeyPrefix.endsWith(":desktop"));
    if (!phones || !computers || !answer.adjustments) return null;
    for (const [device, expensive, other] of [["mobile", phones, computers], ["desktop", computers, phones]] as const) {
      if (expensive.verdict !== EXPENSIVE || other.verdict !== WITHIN || other.costPerLeadRub === null || other.leads < DEVICE_MIN_LEADS) continue;
      const expected = expensive.spendRub / other.costPerLeadRub;
      if (expected < DEVICE_EXPECTED_LEADS || expensive.leads > expected / DEVICE_GAP) continue;
      const current = answer.adjustments[device];
      if (current.percent <= DEVICE_FLOOR) continue;
      if (current.changedOn !== null && daysBetween(current.changedOn, today) < DEVICE_PAUSE_DAYS) continue;
      const percent = Math.max(DEVICE_FLOOR, current.percent - DEVICE_STEP);
      return { device, expensive, other, percent, step: current.percent - percent };
    }
    return null;
  }

  /**
   * Monday's review (add-agent-analyst-stage1 decision 7): closes the hypotheses whose day has come by the direction's
   * cost of a lead against the goal, then writes one for the week from the device breakdown.
   */
  private async weeklyReview(snapshot: TurnSnapshot, tools: AgentToolbox): Promise<TurnResult> {
    const goal = factKey.goal();
    const keys = new Set(snapshot.facts.map((f) => f.key));
    const done: string[] = [];
    const calls: ToolCallRecord[] = [];
    const act = async (command: Command, insight: InsightDraft, what: string) => {
      const result = await tools.act(command, insight);
      calls.push({ command, insight, result });
      if (result.status !== "rejected") done.push(what);
    };
    // The review acts on the breakdowns as a daily turn does (weekly review instructions, step 4).
    await this.analystLevers(snapshot, tools, act);
    const journal = await tools.hypotheses();
    const direction = snapshot.directions.find((d) => d.status === "active" && d.spend14Rub > 0);
    const cpl = direction === undefined ? null : factKey.direction(direction.id, "cost_per_lead", "14d");
    for (const hypothesis of journal.filter((h) => h.status === "checking" && h.checkOn <= snapshot.today)) {
      const within = direction !== undefined && cpl !== null && keys.has(cpl) && direction.leads14 > 0 && direction.spend14Rub / direction.leads14 <= snapshot.goal.costPerLeadRub;
      const result = await tools.saveHypothesis({
        id: hypothesis.id,
        statement: hypothesis.statement,
        factKeys: cpl !== null && keys.has(cpl) ? [cpl, goal] : [goal, factKey.budget("budget_left")],
        check: hypothesis.check,
        checkOn: hypothesis.checkOn,
        status: within ? "confirmed" : "rejected",
        result: within ? "Цена обращения рекламы укладывается в цель." : "Цена обращения рекламы пока выше цели.",
      });
      if (result.status === "applied") done.push("подвели итог гипотезы");
    }
    if (direction !== undefined && journal.filter((h) => h.status === "checking").length < 10) {
      const devices = await tools.breakdown(direction.id, "device");
      const phones = devices.status === "ok" ? devices.rows.find((r) => r.factKeyPrefix.endsWith(":mobile")) : undefined;
      const checkOn = addDays(snapshot.today, HYPOTHESIS_CHECK_DAYS);
      const draft =
        phones !== undefined && phones.verdict === EXPENSIVE
          ? { statement: "С телефонов клиенты обходятся дороже цели.", factKeys: [key(phones, "spend"), key(phones, "leads"), goal], check: "Через неделю сравним цену обращения с телефонов с целью." }
          : cpl !== null && keys.has(cpl)
            ? { statement: "Реклама приводит клиентов по цене около цели.", factKeys: [cpl, goal], check: "Через неделю сравним цену обращения рекламы с целью." }
            : null;
      if (draft !== null && !journal.some((h) => h.status === "checking" && h.statement === draft.statement)) {
        const result = await tools.saveHypothesis({ ...draft, checkOn, status: "checking" });
        if (result.status === "applied") done.push("записал гипотезу на неделю");
      }
    }
    const summary = done.length > 0 ? `Разбор недели: ${done.join(", ")}.` : "Разбор недели: новых выводов нет.";
    return { summary, calls, usage: null };
  }
}

export interface VerdictChange {
  turn: number;
  call: number;
  command: Command["type"];
  before: string;
  after: string;
}

const verdictOf = (call: ToolCallRecord): string => (call.result.status === "rejected" ? `rejected:${call.result.code}` : call.result.status);

/** Report for guardrail regressions: which recorded calls now get a different verdict. */
export const compareVerdicts = (recorded: readonly TurnResult[], replayed: readonly TurnResult[]): VerdictChange[] =>
  recorded.flatMap((turn, t) =>
    turn.calls.flatMap((call, c) => {
      if (call.command === null) return [];
      const now = replayed[t]?.calls[c];
      const after = now ? verdictOf(now) : "missing";
      return verdictOf(call) === after ? [] : [{ turn: t, call: c, command: call.command.type, before: verdictOf(call), after }];
    }),
  );

/** Replays recorded turns through current guards (regression of guardrail changes). */
export class ReplayPolicy implements AgentRuntime {
  readonly name = "policy:replay";
  readonly instructionsVersion = "replay";
  readonly decides = true;
  private index = 0;
  constructor(private readonly turns: readonly { trigger: TurnTrigger; calls: readonly Omit<ToolCallRecord, "result">[]; summary?: string }[]) {}
  async runTurn(input: { tools: AgentToolbox }): Promise<TurnResult> {
    const turn = this.turns[this.index++];
    if (!turn) {
      return { summary: "replay exhausted", calls: [], usage: null };
    }
    const calls: ToolCallRecord[] = [];
    for (const call of turn.calls) {
      const result = call.command === null ? await input.tools.observe({ ...call.insight, decision: call.insight.decision ?? "" }) : await input.tools.act(call.command, call.insight);
      calls.push({ ...call, result });
    }
    // The recorded summary when there is one, so a replayed turn reads as the original (weekly-simulation-triggered-agent).
    return { summary: turn.summary ?? `replayed ${calls.length} calls`, calls, usage: null };
  }
}
