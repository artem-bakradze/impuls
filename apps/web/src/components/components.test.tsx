import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";
import type { HistoryItem, Names } from "@/lib/history-view";
import { LoginCard } from "./LoginCard";
import { RollbackDialog } from "./history/RollbackDialog";
import type { RollbackOutput } from "./history/RollbackDialog";
import { BudgetStep } from "./wizard/BudgetStep";
import { CardStep } from "./wizard/CardStep";
import { DirectStep } from "./wizard/DirectStep";
import { GoalsStep } from "./wizard/GoalsStep";
import { LaunchStep } from "./wizard/LaunchStep";
import { TurnView } from "./history/TurnView";
import { Wizard } from "./wizard/Wizard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const names: Names = { directions: {}, channels: {}, ads: {}, strategies: {} };
const scheduleChange: HistoryItem = {
  id: "chg-1",
  at: "2026-10-28T10:00:00Z",
  author: "user",
  object: "Реклама в поиске",
  diff: [{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }],
  explanation: "Вы изменили время показа.",
  outcome: null,
  turnId: null,
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: ["вернётся прежнее расписание показов"] },
  budgetAdjustment: false,
};

describe("LoginCard", () => {
  it("describes the simulation by days, as the studio lives it", () => {
    render(<LoginCard errorText={null} testLogin={false} signInWithGoogle={() => Promise.resolve()} signInForTests={() => Promise.resolve()} />);
    expect(screen.getByText(/месяц рекламы по дням/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/по неделям|после каждой недели/);
  });
});

describe("BudgetStep", () => {
  const withBudget = (amount: number) => {
    const draft = emptyDraft();
    draft.budget.monthlyBudgetRub = amount;
    return draft;
  };

  it("warns about a budget below the recommended 10 000 ₽", () => {
    render(<BudgetStep draft={withBudget(5_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByText(/обращений будет мало/)).toBeInTheDocument();
    expect(screen.getByTestId("budget-ceiling").textContent?.replace(/[\u00a0\u202f]/g, " ")).toBe("Не больше 5 000 ₽ в месяц");
  });

  it("explains the 3 000 ₽ minimum", () => {
    render(<BudgetStep draft={withBudget(2_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByText(/Минимальный бюджет — 3 000 ₽ в месяц/)).toBeInTheDocument();
  });

  it("shows no invented cost per lead: it becomes clear after the first week", () => {
    render(<BudgetStep draft={withBudget(15_000)} onChange={() => undefined} today="2026-11-01" />);
    expect(screen.getByTestId("auto-goal")).toHaveTextContent(/^Сколько будут стоить обращения, станет видно после первой недели работы\./);
    expect(screen.queryByText(/за обращение/)).toBeNull();
  });

  it("explains a smaller sum when the ads start at the end of the month", () => {
    render(<BudgetStep draft={withBudget(30_000)} onChange={() => undefined} today="2026-10-29" />);
    expect(screen.getByTestId("budget-ceiling").textContent?.replace(/[  ]/g, " ")).toBe("В октябре — не больше 2 903 ₽");
    expect(screen.getByText(/До конца месяца осталось 3 дня, поэтому тратим только часть суммы\./)).toBeInTheDocument();
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

describe("DirectStep", () => {
  it("offers to connect the real account in production", () => {
    render(<DirectStep directApiMode="production" connected={false} outcome={null} onConnect={() => undefined} />);
    expect(screen.getByRole("link", { name: "Подключить Яндекс Директ" })).toHaveAttribute("href", "/api/direct/oauth/start");
    expect(screen.queryByText(/стенде Яндекс Директ не подключён/)).not.toBeInTheDocument();
  });

  it("explains a declined consent and offers to try again", () => {
    render(<DirectStep directApiMode="production" connected={false} outcome="denied" onConnect={() => undefined} />);
    expect(screen.getByText("Без доступа к Яндекс Директу мы не сможем запустить рекламу")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Подключить ещё раз" })).toBeInTheDocument();
  });

  it("shows the connected account without another button: the launch summary follows on the same step", () => {
    render(<DirectStep directApiMode="production" connected outcome="connected" onConnect={vi.fn()} />);
    expect(screen.getByText("Яндекс Директ подключён")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const withSite = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.siteUrl = "https://nogotok.example";
  return draft;
};

describe("GoalsStep", () => {
  it("has the two usual goals checked and checks the Metrica counter when the step opens", async () => {
    let saved: OnboardingDraft | null = null;
    const check = vi.fn().mockResolvedValue({ kind: "done", output: { status: "found", counterId: 12345678 } });
    const { rerender } = render(<GoalsStep draft={withSite()} onChange={(d) => (saved = d)} checkCounter={check} />);
    expect(screen.getByRole("checkbox", { name: /Заявка или запись с сайта/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Нажатие на номер телефона/ })).toBeChecked();
    await waitFor(() => expect(saved?.counter).toEqual({ siteUrl: "https://nogotok.example", status: "found", counterId: 12345678 }));
    expect(check).toHaveBeenCalledOnce();
    rerender(<GoalsStep draft={saved ?? withSite()} onChange={() => undefined} checkCounter={check} />);
    expect(screen.getByTestId("counter-check")).toHaveTextContent("Счётчик Метрики на сайте есть · № 12345678");
  });

  it("warns without blocking when the counter is missing and offers to check again", () => {
    const draft = { ...withSite(), counter: { siteUrl: "https://nogotok.example", status: "not_found" as const, counterId: null } };
    const check = vi.fn();
    render(<GoalsStep draft={draft} onChange={() => undefined} checkCounter={check} />);
    expect(check).not.toHaveBeenCalled();
    expect(screen.getByTestId("counter-check")).toHaveTextContent("Счётчик Метрики на сайте не нашли");
    expect(screen.getByTestId("counter-check")).toHaveTextContent("обращения с сайта не будут посчитаны");
    expect(screen.getByRole("button", { name: /Проверить ещё раз/ })).toBeInTheDocument();
  });
});

describe("CardStep", () => {
  it("shows one notice instead of a mark at every optional field when the site gave almost nothing", () => {
    render(<CardStep draft={withSite()} onChange={() => undefined} />);
    expect(screen.getByTestId("card-sparse")).toHaveTextContent("заполните услугу и город, остальное по желанию");
    expect(screen.queryByText("Не нашли — можно дописать")).toBeNull();
    expect(screen.getAllByText("Не нашли — заполните")).toHaveLength(2);
  });
});

describe("LaunchStep", () => {
  const ready = (): OnboardingDraft => {
    const draft = withSite();
    draft.card = { ...draft.card, category: "Маникюр", city: "Москва", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }] };
    draft.budget.monthlyBudgetRub = 15_000;
    draft.ads = { search: [{ title: "Маникюр", text: "У метро" }], network: [] };
    draft.keywords = { search: ["маникюр"], negative: [] };
    draft.directConnected = true;
    return draft;
  };

  it("sums up in four lines, each with «изменить», and warns about the missing counter", () => {
    const onEdit = vi.fn();
    render(<LaunchStep draft={ready()} today="2026-11-01" onEdit={onEdit} />);
    for (const title of ["Что рекламируем", "Где и когда", "Бюджет", "Что считаем обращением"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText(/в неделю/)).toBeNull();
    expect(screen.queryByText(/Цена обращения/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Бюджет: изменить" }));
    expect(onEdit).toHaveBeenCalledWith(2);
    expect(screen.getByTestId("measurement-status")).toHaveTextContent("Учёт обращений ещё не проверен");
  });

  it("says what happens after the launch and that changes are in the history", () => {
    render(<LaunchStep draft={ready()} today="2026-11-01" onEdit={() => undefined} />);
    const note = screen.getByTestId("after-launch");
    expect(note).toHaveTextContent("Яндекс проверит объявления");
    expect(note).toHaveTextContent("Первые цифры появятся на следующий день");
    expect(note).toHaveTextContent("видно в истории");
    expect(note.textContent).not.toContain("журнал");
  });

  it("names what is advertised without repeating the category", () => {
    render(<LaunchStep draft={ready()} today="2026-11-01" onEdit={() => undefined} />);
    expect(screen.getByText("Маникюр с покрытием")).toBeInTheDocument();
    expect(screen.queryByText("Маникюр: Маникюр с покрытием")).toBeNull();
  });

  it("speaks of the chosen way on the last step: the simulation has its own title and no scenario to choose", () => {
    render(<Wizard initialDraft={ready()} initialStep={3} directApiMode="simulator" directOutcome={null} />);
    expect(screen.getByText("Шаг 3 из 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Объявления и запуск" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Симуляция"));
    expect(screen.getByRole("heading", { name: "Запустите симуляцию" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("списываются с его баланса");
    expect(screen.queryByLabelText("Обычный месяц")).toBeNull();
    expect(document.body.textContent).not.toMatch(/сценари/i);
    expect(document.body.textContent).toContain("цифры рекламы задаёте вы сами");
    expect(screen.getByTestId("after-launch")).toHaveTextContent("откроется «Реклама»: вы вносите статистику за выбранный период");
    expect(screen.getByRole("button", { name: /Запустить симуляцию/ })).toBeInTheDocument();
    // The simulated month starts on the 1st: the budget line is for a full month.
    expect(document.body.textContent).not.toContain("В этом месяце — до");
  });

  it("distinguishes a found counter from confirmed event delivery", () => {
    const draft = { ...ready(), counter: { siteUrl: "https://nogotok.example", status: "found" as const, counterId: 1 } };
    render(<LaunchStep draft={draft} today="2026-11-01" onEdit={() => undefined} />);
    expect(screen.getByTestId("measurement-status")).toHaveTextContent("получение обращений пока не подтверждено");
  });
});

describe("TurnView (change-history spec «Страница решения сервиса»)", () => {
  const turn = {
    trigger: "daily_review", runtime: "openai-agents:test", instructionsVersion: "2026-11-03.3", status: "completed", startedAt: "2026-11-08T03:00:00Z", context: { goal: 1000 },
    calls: [
      { insight: { observation: "Реклама в поиске упирается в недельный лимит." }, result: { status: "rejected", message: "не хватает остатка бюджета месяца" } },
      { insight: { observation: "Поднимаю цену перехода на 10 пунктов при цели 1000 ₽." }, result: { status: "applied", message: "выполнено" } },
    ],
  };

  it("speaks plainly, keeps the executor for specialists and returns to the history sheet", () => {
    render(<TurnView turn={turn} timeZone="Europe/Moscow" />);
    expect(screen.getByText("Сервис не дал это сделать")).toBeTruthy();
    expect(screen.getByText("Сделано")).toBeTruthy();
    expect(screen.getByText("Итог: не хватает остатка бюджета месяца")).toBeTruthy();
    // The agent's words read as in the history: percent, grouped rubles, and no «Итог: выполнено» under «Сделано».
    expect(screen.getByText("Поднимаю цену перехода на 10% при цели 1 000 ₽.")).toBeTruthy();
    expect(screen.queryByText("Итог: выполнено")).toBeNull();
    expect(document.body.textContent).not.toMatch(/ограничител/i);
    expect(screen.queryByText(/openai-agents:test/)).toBeNull();
    fireEvent.click(screen.getByText("Для специалистов: данные, которые видел сервис"));
    expect(screen.getByTestId("turn-tech")).toHaveTextContent("версия инструкций 2026-11-03.3");
    expect(screen.getByRole("link", { name: /К истории/ })).toHaveAttribute("href", "/summary#history");
  });
});
