import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SettingsModel } from "@/lib/settings-model";
import { SettingsView } from "./SettingsView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const model: SettingsModel = {
  timeZone: "Europe/Moscow", card: { category: "Маникюр", services: [{ name: "Маникюр", priceRub: 1800 }], advantages: [] },
  city: "Москва", schedule: { raw: "Пн–Вс 10:00–20:00", days: "Пн–Вс", from: "10:00", to: "20:00" }, monthlyBudgetRub: 15000, goal: { mode: "auto", rub: 500 },
  paused: false, supportEmail: "support@impuls.test", siteUrl: "https://example.test", directions: [],
  miniSite: { published: false, slug: "", businessName: "", phone: "", address: "", hours: "", telegram: "", metrikaCounterId: null, advertiserName: "", advertiserInn: "", services: [] },
  goals: ["Заявка или запись с сайта"], budgetAdjustments: [],
  ads: [{ id: "a1", title: "Первый вариант", text: "Запишитесь онлайн", direction: "Поиск", status: "active", moderation: "accepted" }, { id: "a2", title: "Второй вариант", text: "Без выходных", direction: "Поиск", status: "paused", moderation: "accepted" }],
};

describe("settings disclosure", () => {
  it("opens one editor and discards the draft on cancel without sending a command", () => {
    const request = vi.spyOn(globalThis, "fetch");
    render(<SettingsView model={model} simulated />);
    expect(screen.queryByLabelText("Город показа")).toBeNull();
    expect(screen.queryByLabelText("Бюджет в месяц")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Изменить: Город" }));
    expect(screen.queryByText("Москва", { exact: true })).toBeNull();
    fireEvent.change(screen.getByLabelText("Город показа"), { target: { value: "Тула" } });
    expect(screen.getByRole("button", { name: "Сохранить город" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отмена: Город" }));
    expect(screen.queryByLabelText("Город показа")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Изменить: Город" }));
    expect(screen.getByLabelText("Город показа")).toHaveValue("Москва");
    fireEvent.click(screen.getByRole("button", { name: "Изменить: Бюджет в месяц" }));
    expect(screen.queryByLabelText("Город показа")).toBeNull();
    expect(screen.getByLabelText("Бюджет в месяц")).toHaveValue("15 000");
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });

  it("has the four sections, the site and the account in one line, and no ads or training-market notes", () => {
    const { container } = render(<SettingsView model={{ ...model, budgetAdjustments: [{ id: "b1", at: "2026-11-01T06:00:00Z", text: "Реклама в поиске: было 2 700 ₽ в неделю → стало 2 574 ₽ в неделю" }] }} simulated />);
    expect([...container.querySelectorAll(".settings-section h2")].map((h) => h.textContent)).toEqual(["Что рекламируем", "Где и когда", "Бюджет и цель", "Что считаем обращением"]);
    expect(screen.getByTestId("leads-section")).toHaveTextContent("Заявка или запись с сайта");
    expect(document.getElementById("ads")).toBeNull();
    expect(screen.getByTestId("site-change")).toHaveTextContent("Объявления ведут на example.test. Сменить сайт или удалить аккаунт — напишите на support@impuls.test.");
    expect(container.textContent).not.toMatch(/учебном рынке/);
    fireEvent.click(screen.getByText("Для специалистов"));
    expect(screen.getByTestId("budget-adjustments")).toHaveTextContent("Реклама в поиске: было 2 700 ₽ в неделю → стало 2 574 ₽ в неделю");
  });
});
