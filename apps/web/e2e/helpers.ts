import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const uniqueEmail = (prefix: string): string => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.impuls.test`;

/** Test-only login (AUTH_TEST_LOGIN=enabled); a new account opens the first wizard step. */
export const login = async (page: Page, email: string): Promise<void> => {
  await page.goto("/");
  await page.getByLabel("Почта для тестового входа").fill(email);
  await page.getByLabel("Имя для тестового входа").fill("Анна");
  await page.getByRole("button", { name: "Войти для проверки" }).click();
};

/** Picks an option in an Ant Design select opened by its accessible label. */
export const choose = async (page: Page, label: string, option: string): Promise<void> => {
  await page.getByLabel(label).click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: new RegExp(`^${option}$`) }).click();
};

export const expectStep = async (page: Page, step: number, title: string): Promise<void> => {
  await expect(page.getByTestId("wizard-step")).toHaveText(`Шаг ${step} из 6`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
};

export const next = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Дальше" }).click();
};

/** Steps 1–3 of the wizard with the owner's site (the ads' landing page) and a Yandex Maps link. */
export const fillFirstSteps = async (page: Page): Promise<void> => {
  await expectStep(page, 1, "Где вас найти?");
  // «Дальше» is always pressable: an empty step shows the error right at the field.
  await next(page);
  await expect(page.getByRole("alert").filter({ hasText: "Укажите адрес вашего сайта" })).toBeVisible();
  // Owners type links without https://; the wizard completes them.
  await page.getByLabel("Ваш сайт").fill("nogotok.example");
  await page.getByLabel("Организация в Яндекс Картах").fill("yandex.ru/maps/org/nogotok/123");
  await expect(page.getByLabel("Ваш сайт")).toHaveValue("https://nogotok.example");
  await next(page);

  await expectStep(page, 2, "Вот как мы вас поняли");
  await page.getByLabel("Название").fill("Ноготок");
  await page.getByLabel("Чем вы занимаетесь").fill("Маникюр");
  await page.getByLabel("Услуга 1").fill("Маникюр с покрытием");
  await page.getByLabel("Адрес").fill("Москва, Профсоюзная улица, 1");
  // The city follows the address; ads are shown in the city, not in a radius.
  await expect(page.getByLabel("Город", { exact: true })).toHaveValue("Москва");
  // No price was given, so the field is marked instead of filled in.
  await expect(page.getByText("Цены не нашли — можно дописать")).toBeVisible();
  await page.getByLabel("Цена услуги 1").fill("1800");
  await next(page);

  await expectStep(page, 3, "Что для вас клиент?");
  // The two usual goals are checked in advance.
  await expect(page.getByLabel("Звонок по номеру с сайта")).toBeChecked();
  // The test site does not exist, so the counter check says so without blocking the launch.
  await expect(page.getByTestId("counter-check")).toContainText("Не получилось открыть сайт, чтобы проверить счётчик");
  await next(page);
};

export const fillBudget = async (page: Page): Promise<void> => {
  await expectStep(page, 4, "Бюджет");
  await page.getByLabel("Бюджет в месяц").fill("15000");
  // No cost-per-lead question: the goal is selected automatically.
  await expect(page.getByLabel("Цена одного обращения")).toHaveCount(0);
  await expect(page.getByTestId("auto-goal")).toContainText("Сколько будут стоить обращения, станет видно после первой недели работы");
};

/** Steps 4–6 and «Запустить»; ends on the summary. */
export const finishWizard = async (page: Page): Promise<void> => {
  await next(page);
  await expectStep(page, 5, "Как увидят ваши объявления");
  await expect(page.getByTestId("ad-search").first()).toBeVisible();
  await next(page);

  await expectStep(page, 6, "Подключите Яндекс Директ и запустите");
  await page.getByRole("button", { name: "Продолжить в тестовом режиме" }).click();
  // Connected: the launch summary appears on the same step.
  await expectStep(page, 6, "Подключите Яндекс Директ и запустите");
  await expect(page.getByText("Город «Москва»")).toBeVisible();
  await page.getByRole("button", { name: "Запустить" }).click();
  await page.waitForURL("**/summary");
};

export const launchNewBusiness = async (page: Page, prefix: string, email: string = uniqueEmail(prefix)): Promise<void> => {
  await login(page, email);
  await page.waitForURL("**/wizard");
  await fillFirstSteps(page);
  await fillBudget(page);
  await finishWizard(page);
};
