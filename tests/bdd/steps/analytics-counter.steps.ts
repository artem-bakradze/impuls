import { checkCounter } from "@impuls/worker";
import type { CounterCheck } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("analytics/counter.feature"), { language: "ru" });

const SITE = "https://nogotok.example";

describeFeature(feature, ({ Scenario }) => {
  // The page download is replaced here; the real one goes through the worker's public-page fetcher.
  let page: (url: string) => Promise<string>;
  let result: CounterCheck;
  const check = async () => {
    result = await checkCounter(SITE, page);
  };

  Scenario("Код установлен", ({ Given, When, Then }) => {
    Given("на сайте владельца стоит код Метрики со счётчиком 12345678", () => {
      page = () => Promise.resolve(`<html><head><script>ym(12345678, "init", { webvisor: true });</script></head><body>Ноготок</body></html>`);
    });
    When("сервис проверяет сайт", check);
    Then("результат — «счётчик есть» с номером 12345678", () => {
      expect(result).toEqual({ status: "found", counterId: 12345678 });
    });
  });

  Scenario("Код не найден", ({ Given, When, Then }) => {
    Given("на сайте владельца нет кода Метрики", () => {
      page = () => Promise.resolve("<html><body>Ноготок — маникюр у метро</body></html>");
    });
    When("сервис проверяет сайт", check);
    Then("результат — «счётчик не нашли»", () => {
      expect(result).toEqual({ status: "not_found" });
    });
  });

  Scenario("Сайт не открылся", ({ Given, When, Then }) => {
    Given("сайт владельца не отвечает", () => {
      page = () => Promise.reject(new Error("timeout"));
    });
    When("сервис проверяет сайт", check);
    Then("результат — «сайт не открылся», а не ошибка", () => {
      expect(result).toEqual({ status: "unreachable" });
    });
  });
});
