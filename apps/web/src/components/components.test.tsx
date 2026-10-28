import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/onboarding";
import type { HistoryItem, Names } from "@/lib/history-view";
import { HistoryEntry } from "./history/HistoryView";
import { RollbackDialog } from "./history/RollbackDialog";
import type { RollbackOutput } from "./history/RollbackDialog";
import { BudgetStep } from "./wizard/BudgetStep";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const names: Names = { directions: {}, ads: {}, strategies: {} };
const scheduleChange: HistoryItem = {
  id: "chg-1",
  at: "2026-10-28T10:00:00Z",
  author: "user",
  type: "settings",
  object: "Направление «Маникюр — Поиск»",
  diff: [{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }],
  explanation: "Вы изменили время показа.",
  outcome: null,
  turnId: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: ["вернётся прежнее расписание показов"] },
};

describe("BudgetStep", () => {
  const withBudget = (amount: number) => {
    const draft = emptyDraft();
    draft.budget.monthlyBudgetRub = amount;
    return draft;
  };

  it("warns about a budget below the recommended 10 000 ₽", () => {
    render(<BudgetStep draft={withBudget(5_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByText(/обращений будет мало/)).toBeInTheDocument();
    expect(screen.getByTestId("budget-ceiling").textContent?.replace(/ /g, " ")).toBe("Больше 5 000 ₽ за месяц мы не потратим");
  });

  it("explains the 3 000 ₽ minimum", () => {
    render(<BudgetStep draft={withBudget(2_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByText(/Минимальный бюджет — 3 000 ₽ в месяц/)).toBeInTheDocument();
  });

  it("shows the forecast placeholder instead of invented numbers", () => {
    render(<BudgetStep draft={withBudget(15_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByText("Прогноз обращений появится после первой недели работы.")).toBeInTheDocument();
  });
});

describe("history entry", () => {
  it("shows «было → стало» and the rollback button", () => {
    render(<HistoryEntry item={scheduleChange} timeZone="Europe/Moscow" onRollback={() => undefined} />);
    expect(screen.getByText("Вы")).toBeInTheDocument();
    expect(screen.getByText("Время показа: было «Пн–Вс 10:00–20:00» → стало «Пн–Вс 10:00–21:00»")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вернуть как было" })).toBeInTheDocument();
  });

  it("explains why an irreversible change has no button", () => {
    const irreversible: HistoryItem = { ...scheduleChange, rollback: { kind: "unavailable", reason: "Это нельзя вернуть: итог проверки уже посчитан по фактическим данным." } };
    render(<HistoryEntry item={irreversible} timeZone="Europe/Moscow" onRollback={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Вернуть как было" })).toBeNull();
    expect(screen.getByText(/итог проверки уже посчитан/)).toBeInTheDocument();
  });
});

describe("RollbackDialog", () => {
  it("shows consequences, then offers to roll back later changes together", async () => {
    const run = vi
      .fn<(body: { entryId: string; includeLater?: boolean }) => Promise<{ kind: "done"; output: RollbackOutput }>>()
      .mockResolvedValueOnce({ kind: "done", output: { kind: "needs_chain", later: [{ id: "chg-2", explanation: "Вы изменили время показа ещё раз." }] } })
      .mockResolvedValueOnce({ kind: "done", output: { kind: "done", entryIds: ["chg-3", "chg-4"], messages: [] } });
    render(<RollbackDialog item={scheduleChange} items={[scheduleChange]} names={names} onClose={() => undefined} run={run} />);
    expect(screen.getByText("Вернётся прежнее расписание показов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть как было" }));
    await waitFor(() => expect(screen.getByText("Вы изменили время показа ещё раз.")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Вернуть всё по порядку"));
    await waitFor(() => expect(screen.getByText(/вернули как было/)).toBeInTheDocument());
    expect(run).toHaveBeenLastCalledWith({ entryId: "chg-1", includeLater: true });
  });

  it("shows the Direct cabinet difference before overwriting it", async () => {
    const run = vi.fn().mockResolvedValue({ kind: "done", output: { kind: "state_differs", expected: { status: "active" }, actual: { status: "paused" } } });
    render(<RollbackDialog item={scheduleChange} items={[scheduleChange]} names={names} onClose={() => undefined} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Вернуть как было" }));
    await waitFor(() => expect(screen.getByText("Показы: у нас записано «работает», в Директе сейчас «на паузе»")).toBeInTheDocument());
    expect(screen.getByText("Всё равно вернуть")).toBeInTheDocument();
  });
});
