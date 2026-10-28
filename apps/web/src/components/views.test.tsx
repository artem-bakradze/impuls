import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExperimentsModel } from "@/lib/experiments-model";
import type { SummaryModel } from "@/lib/summary-model";
import { ExperimentsView } from "./experiments/ExperimentsView";
import { SummaryView } from "./summary/SummaryView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/summary", useSearchParams: () => new URLSearchParams() }));

const summary = (overrides: Partial<SummaryModel> = {}): SummaryModel => ({
  timeZone: "Europe/Moscow",
  period: "week",
  state: "running",
  moderation: { pending: 0, accepted: 3, rejected: 0 },
  monthBudget: 1_500_000,
  spentMonth: 630_000,
  spend: { value: 630_000, previous: 500_000 },
  leads: { value: 11, previous: 8 },
  clients: { value: 7, previous: 5 },
  clientCost: { kind: "known", costPerClient: 90_000, clients: 7, week: "2026-10-19" },
  goal: { mode: "user", cso: 30_000, current: 34_000, status: "above" },
  actions: [{ id: "c1", at: "2026-10-27T06:00:00Z", text: "Отключил объявление «Маникюр без записи»: за 2 недели оно потратило 2 400 ₽." }],
  attention: { notifications: [], approvals: [], clientsQuestion: { week: "2026-10-19", weekEnd: "2026-10-25", leads: 11 } },
  directions: [{ id: "d1", name: "Маникюр — Поиск", channel: "search", status: "active", spend: 630_000, leads: 11, costPerLead: 57_273 }],
  ...overrides,
});

describe("SummaryView", () => {
  it("shows the four numbers, the goal line, the service's actions and the clients question", () => {
    const { container } = render(<SummaryView model={summary()} />);
    const text = container.textContent?.replace(/[  ]/g, " ") ?? "";
    expect(text).toContain("Цель: до 300 ₽ за обращение · Сейчас: 340 ₽");
    expect(text).toContain("дороже цели");
    expect(text).toContain("Отключил объявление «Маникюр без записи»");
    expect(text).toContain("Подробнее по направлениям");
    expect(text).toMatch(/клиентами/);
    expect(container).toMatchSnapshot();
  });

  it("shows the hint instead of an invented cost per client", () => {
    const { container } = render(
      <SummaryView model={summary({ clientCost: { kind: "unknown", costPerLead: 57_273, hint: "Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента", week: "2026-10-19" } })} />,
    );
    expect(container.textContent).toContain("Ответьте, сколько обращений стали клиентами, чтобы видеть стоимость клиента");
  });

  it("shows the launch state on the first day instead of zeros", () => {
    const { container } = render(<SummaryView model={summary({ state: "first_day", moderation: { pending: 3, accepted: 0, rejected: 0 } })} />);
    expect(container.textContent).toContain("Первые результаты появятся в течение суток");
  });
});

const experiments: ExperimentsModel = {
  minDays: 7,
  maxDays: 21,
  minClicks: 100,
  maxActive: 2,
  running: [
    {
      id: "e1",
      hypothesis: "Проверяем, приведёт ли «−15% на первый визит» больше записей, чем цена",
      direction: "Маникюр — Поиск",
      startedOn: "2026-10-20",
      day: 8,
      status: "running",
      outcome: null,
      control: { title: "Маникюр 1 800 ₽", clicks: 120, leads: 6, spend: 300_000 },
      variant: { title: "−15% на первый визит", clicks: 110, leads: 9, spend: 280_000 },
    },
  ],
  finished: [
    {
      id: "e0",
      hypothesis: "Проверяем заголовок",
      direction: "Педикюр — Поиск",
      startedOn: "2026-09-20",
      day: 21,
      status: "finished",
      outcome: "Вариант «Педикюр за час» приводил клиентов на 32% дешевле — оставили его.",
      control: { title: "Педикюр", clicks: 200, leads: 6, spend: 500_000 },
      variant: { title: "Педикюр за час", clicks: 210, leads: 10, spend: 500_000 },
    },
  ],
};

describe("ExperimentsView («Проверяем»)", () => {
  it("shows the hypothesis in plain words, progress and the result of finished checks", () => {
    render(<ExperimentsView model={experiments} />);
    expect(screen.getByText(/Проверяем, приведёт ли «−15% на первый визит»/)).toBeTruthy();
    expect(screen.getByText(/32% дешевле — оставили его/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/CTR|конверси|ставк/i);
  });
});
