import { expect, test } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrl } from "./env";
import { launchNewBusiness, uniqueEmail } from "./helpers";

/** Seeds an agent turn and the history entry it created, as the worker would after an agent action. */
const seedAgentTurn = async (email: string): Promise<void> => {
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
        justification: { reasonCode: "SCALE", text: "Это направление приводит клиентов дешевле цели, поэтому я выделил ему больше денег." },
        result: { status: "clamped", message: "урезано: не больше +20% за шаг" },
      },
    ];
    await client.query(
      `INSERT INTO agent_turns (id, business_id, trigger, runtime, instructions_version, status, context, calls, summary, started_at, finished_at)
       VALUES ($1, $2, 'daily_review', 'policy:e2e', 'v1', 'completed', $3, $4, 'ok', now(), now())`,
      [turnId, row.id, JSON.stringify({ trigger: { kind: "daily_review" } }), JSON.stringify(calls)],
    );
    await client.query(
      `INSERT INTO change_log (id, business_id, actor, author, action, object_kind, object_id, before, after, status, reason_code, explanation, turn_id)
       VALUES ($1, $2, 'agent', 'service', $3, 'direction', $4, $5, $6, 'applied', 'SCALE', $7, $8)`,
      [
        `chg-e2e-${Date.now()}`,
        row.id,
        JSON.stringify(calls[0]?.command),
        row.campaign,
        JSON.stringify({ status: "active", weeklyLimit: 300_000, strategyId: "WB_MAXIMUM_CLICKS" }),
        JSON.stringify({ status: "active", weeklyLimit: 360_000, strategyId: "WB_MAXIMUM_CLICKS" }),
        calls[0]?.justification.text,
        turnId,
      ],
    );
  } finally {
    await client.end();
  }
};

test("from a history entry made by the agent the owner opens the turn with guard verdicts", async ({ page }) => {
  const email = uniqueEmail("turn");
  await launchNewBusiness(page, "turn", email);
  await seedAgentTurn(email);

  await page.getByRole("link", { name: "История" }).click();
  const entry = page.getByTestId("history-entry").filter({ hasText: "выделил ему больше денег" });
  await entry.getByRole("link", { name: "Как сервис принял это решение" }).click();

  await expect(page.getByRole("heading", { name: "Как сервис принял решение" })).toBeVisible();
  await expect(page.getByTestId("turn-summary")).toContainText("Ежедневный разбор");
  const call = page.getByTestId("turn-call");
  await expect(call).toContainText("Урезано ограничителем");
  await expect(call).toContainText("урезано: не больше +20% за шаг");
});

test("a turn of another business is not shown", async ({ page }) => {
  await launchNewBusiness(page, "other");
  const response = await page.goto("/history/turn/turn-of-someone-else");
  expect(response?.status()).toBe(404);
});
