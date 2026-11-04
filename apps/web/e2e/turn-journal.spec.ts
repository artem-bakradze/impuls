import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrl } from "./env";
import { launchNewBusiness, uniqueEmail } from "./helpers";

/** Seeds an agent turn, the history entry it created and its insight, as the worker would after an agent action. */
const seedAgentTurn = async (email: string): Promise<string> => {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; campaign: string }>(
      `SELECT b.id, c.id AS campaign FROM businesses b JOIN users u ON u.id = b.user_id JOIN campaigns c ON c.business_id = b.id WHERE u.email = $1 LIMIT 1`,
      [email],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`No launched business for ${email}`);
    }
    const turnId = `turn-e2e-${Date.now()}`;
    const calls = [
      {
        command: { type: "SetSpendLimit", directionId: row.campaign, weeklyLimit: 360_000 },
        insight: {
          reasonCode: "SCALE",
          observation: "Это направление приводит клиентов дешевле цели, поэтому выделили ему больше денег.",
          factKeys: ["goal:goal:now", "budget:budget_left:month"],
          next: "Через неделю проверим, выросло ли число обращений.",
        },
        result: { status: "clamped", message: "урезано: не больше +20% за шаг" },
      },
    ];
    await client.query(
      `INSERT INTO agent_turns (id, business_id, trigger, runtime, instructions_version, status, context, calls, summary, started_at, finished_at)
       VALUES ($1, $2, 'daily_review', 'policy:e2e', 'v1', 'completed', $3, $4, 'ok', now(), now())`,
      [turnId, row.id, JSON.stringify({ trigger: { kind: "daily_review" } }), JSON.stringify(calls)],
    );
    const changeId = `chg-e2e-${Date.now()}`;
    const insightId = `ins-e2e-${Date.now()}`;
    const facts = [
      { key: "goal:goal:now", object: "цель", metric: "goal", period: "now", value: 800, unit: "rub" },
      { key: "budget:budget_left:month", object: "бюджет месяца", metric: "budget_left", period: "month", value: 9_700, unit: "rub" },
    ];
    await client.query(
      `INSERT INTO insights (id, business_id, turn_id, source, reason_code, observation, facts, decision, next, object_ref, created_at)
       VALUES ($1, $2, $3, 'agent', 'SCALE', $4, $5, $6, $7, $8, now())`,
      [
        insightId,
        row.id,
        turnId,
        calls[0]?.insight.observation,
        JSON.stringify(facts),
        JSON.stringify({ kind: "action", text: "Лимит: реклама в поиске — 3 600 ₽ в неделю — урезано: не больше +20% за шаг", status: "clamped", changeIds: [changeId] }),
        calls[0]?.insight.next,
        JSON.stringify({ kind: "direction", id: row.campaign }),
      ],
    );
    await client.query(
      `INSERT INTO change_log (id, business_id, actor, author, action, object_kind, object_id, before, after, status, reason_code, explanation, turn_id, insight_id)
       VALUES ($1, $2, 'agent', 'service', $3, 'direction', $4, $5, $6, 'applied', 'SCALE', $7, $8, $9)`,
      [
        changeId,
        row.id,
        JSON.stringify(calls[0]?.command),
        row.campaign,
        JSON.stringify({ status: "active", weeklyLimit: 300_000, strategyId: "WB_MAXIMUM_CLICKS" }),
        JSON.stringify({ status: "active", weeklyLimit: 360_000, strategyId: "WB_MAXIMUM_CLICKS" }),
        calls[0]?.insight.observation,
        turnId,
        insightId,
      ],
    );
    return turnId;
  } finally {
    await client.end();
  }
};

test("a change made by the agent is in the journal, and its turn with guard verdicts opens at its address", async ({ page }) => {
  const email = uniqueEmail("turn");
  await launchNewBusiness(page, "turn", email);
  const turnId = await seedAgentTurn(email);

  await page.reload();
  await page.getByRole("button", { name: /История/ }).click();
  const change = page.getByTestId("agent-journal").getByTestId("journal-change").filter({ hasText: /Добавил денег рекламе .*3[\s\u00a0]600/ });
  // The change is a done action of the assistant's message, with no disclosure of facts (insights «Лента инсайтов»).
  await expect(change).toBeVisible();
  await expect(change.getByText("На чём основано")).toHaveCount(0);
  await page.goto(`/history/turn/${turnId}`);

  await expect(page.getByRole("heading", { name: "Как сервис принял решение" })).toBeVisible();
  await expect(page.getByTestId("turn-summary")).toContainText("Ежедневный разбор");
  const call = page.getByTestId("turn-call");
  await expect(call).toContainText("Сделано в меньшем размере");
  await expect(call).toContainText("урезано: не больше +20% за шаг");
  await expect(page.locator("main")).not.toContainText("ограничител");
  // Back to the history sheet, not to the bare main screen.
  await page.getByRole("link", { name: /К истории/ }).click();
  await page.waitForURL("**/summary#history");
  await expect(page.getByTestId("agent-journal")).toBeVisible();
});

test("a turn of another business is not shown", async ({ page }) => {
  await launchNewBusiness(page, "other");
  const response = await page.goto("/history/turn/turn-of-someone-else");
  expect(response?.status()).toBe(404);
});
