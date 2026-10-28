import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import type { MiniSiteCard, RenderOptions } from "./card";
import { MiniSiteValidationError } from "./errors";
import { MINI_SITE_GOALS, metrikaGoals } from "./goals";
import { renderMiniSite, telLink, telegramLink, whatsappLink } from "./render";

const options: RenderOptions = { metrikaCounterId: 98765432, advertiser: { name: "ИП Иванова А. С.", inn: "770123456789" } };

const card = (overrides: Partial<MiniSiteCard> = {}): MiniSiteCard => ({
  businessName: "Салон «Ромашка»",
  description: "Стрижки и окрашивание у метро",
  phone: "8 (916) 123-45-67",
  services: [
    { name: "Женская стрижка", price: rubles(1500) },
    { name: "Окрашивание", price: rubles(3000), priceFrom: true, description: "Цена зависит от длины" },
  ],
  photos: [
    { url: "https://cdn.example.ru/1.jpg", width: 800, height: 600, alt: "Зал" },
    { url: "https://cdn.example.ru/2.jpg", width: 800, height: 600 },
  ],
  address: "Москва, ул. Тверская, 1",
  openingHours: [
    { days: "Пн–Пт", hours: "10:00–20:00" },
    { days: "Сб–Вс", hours: "выходной" },
  ],
  messengers: { whatsapp: "+7 916 123 45 67", telegram: "@romashka_salon" },
  bookingUrl: "https://dikidi.net/123",
  ...overrides,
});

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("renderMiniSite", () => {
  it("renders required page structure", () => {
    const { html, assets } = renderMiniSite(card(), options);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
    expect(html).toContain("<h1>Салон «Ромашка»</h1>");
    expect(html).toContain("<main>");
    expect(html).toContain("<footer>");
    expect(html).toContain("Женская стрижка");
    expect(html).toContain("1 500 ₽");
    expect(html).toContain("от 3 000 ₽");
    expect(html).toContain("<dt>Пн–Пт</dt><dd>10:00–20:00</dd>");
    expect(html).toContain("<address>Москва, ул. Тверская, 1</address>");
    expect(html).toContain(
      'src="https://yandex.ru/map-widget/v1/?text=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D1%83%D0%BB.%20%D0%A2%D0%B2%D0%B5%D1%80%D1%81%D0%BA%D0%B0%D1%8F%2C%201&amp;z=16"',
    );
    expect(html).toContain(">Позвонить</a>");
    expect(html).toContain(">Написать в WhatsApp</a>");
    expect(html).toContain(">Написать в Telegram</a>");
    expect(html).toContain('href="https://dikidi.net/123"');
    expect(html).toContain(">Записаться онлайн</a>");
    expect(html).toContain(">Построить маршрут</a>");
    expect(assets).toEqual({});
  });

  it("gives every image explicit dimensions and lazy-loads all but the first", () => {
    const { html } = renderMiniSite(card(), options);
    const images = html.match(/<img [^>]*src="https:\/\/cdn[^>]*>/g) ?? [];
    expect(images).toHaveLength(2);
    for (const img of images) expect(img).toMatch(/width="800" height="600"/);
    expect(images[0]).toContain('loading="eager"');
    expect(images[0]).toContain('alt="Зал"');
    expect(images[1]).toContain('loading="lazy"');
    expect(images[1]).toContain('alt="Салон «Ромашка»"');
  });

  it("renders the mandatory advertiser footer", () => {
    const { html } = renderMiniSite(card(), options);
    expect(html).toMatch(/<footer><p>Рекламодатель: ИП Иванова А\. С\., ИНН 770123456789<\/p><\/footer>/);
  });

  it("omits optional messengers and booking when absent", () => {
    const withoutExtras = card({ messengers: {} });
    delete withoutExtras.bookingUrl;
    const { html } = renderMiniSite(withoutExtras, options);
    expect(html).not.toContain("Написать");
    expect(html).not.toContain('data-goal="messenger"');
    expect(html).not.toContain('data-goal="booking"');
    expect(html).toContain('data-goal="call"');
  });

  it("embeds the Metrika counter and goal triggers", () => {
    const { html } = renderMiniSite(card(), options);
    expect(html).toContain("https://mc.yandex.ru/metrika/tag.js");
    expect(html).toContain('ym(98765432,"init"');
    expect(html).toContain('ym(98765432,"reachGoal",el.getAttribute("data-goal"))');
    expect(html).toContain('href="tel:+79161234567" data-goal="call"');
    expect(countOf(html, 'data-goal="messenger"')).toBe(2);
    expect(countOf(html, 'data-goal="booking"')).toBe(1);
    expect(countOf(html, 'data-goal="route"')).toBe(1);
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toEqual(["<script>"]);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("escapes malicious user input everywhere", () => {
    const payload = `<script>alert("x")</script>' onmouseover='alert(1)`;
    const { html } = renderMiniSite(
      card({
        businessName: payload,
        description: payload,
        services: [{ name: payload, price: rubles(100), description: payload }],
        photos: [{ url: "https://cdn.example.ru/a.jpg?q=\"><script>", width: 10, height: 10, alt: payload }],
        address: payload,
        openingHours: [{ days: payload, hours: payload }],
      }),
      { ...options, advertiser: { name: payload, inn: "7701234567" } },
    );
    expect(countOf(html, "<script")).toBe(1);
    expect(html).not.toContain("alert(\"x\")");
    expect(html).not.toContain("' onmouseover='");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39; onmouseover=&#39;alert(1)");
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "/relative", "not a url"])(
    "rejects unsafe booking URL %s",
    (bookingUrl) => {
      expect(() => renderMiniSite(card({ bookingUrl }), options)).toThrow(MiniSiteValidationError);
    },
  );

  it("rejects unsafe photo URLs and missing dimensions", () => {
    expect(() =>
      renderMiniSite(card({ photos: [{ url: "javascript:alert(1)", width: 1, height: 1 }] }), options),
    ).toThrow(/http or https/);
    expect(() => renderMiniSite(card({ photos: [{ url: "https://a.ru/1.jpg", width: 0, height: 1 }] }), options)).toThrow(
      /width and height/,
    );
  });

  it("fails fast on invalid required options", () => {
    expect(() => renderMiniSite(card(), { ...options, metrikaCounterId: 0 })).toThrow(/metrikaCounterId/);
    expect(() => renderMiniSite(card(), { ...options, advertiser: { name: "ООО Ромашка", inn: "123" } })).toThrow(
      /inn/,
    );
    expect(() => renderMiniSite(card(), { ...options, advertiser: { name: " ", inn: "7701234567" } })).toThrow(/name/);
    expect(() => renderMiniSite(card({ businessName: "" }), options)).toThrow(/businessName/);
  });

  it("stays within the 30 KB budget without photos", () => {
    const services = Array.from({ length: 30 }, (_, i) => ({
      name: `Услуга номер ${i + 1} с довольно длинным названием`,
      price: rubles(1000 + i * 250),
      description: "Краткое описание услуги для посетителя сайта",
    }));
    const { html } = renderMiniSite(card({ services, photos: [] }), options);
    expect(new TextEncoder().encode(html).length).toBeLessThan(30 * 1024);
  });
});

describe("contact links", () => {
  it.each([
    ["8 (916) 123-45-67", "tel:+79161234567"],
    ["+7 916 123-45-67", "tel:+79161234567"],
    ["79161234567", "tel:+79161234567"],
    ["+375 29 123-45-67", "tel:+375291234567"],
  ])("formats tel link for %s", (phone, expected) => {
    expect(telLink(phone)).toBe(expected);
  });

  it("formats WhatsApp link as wa.me with international digits", () => {
    expect(whatsappLink("8 916 123-45-67")).toBe("https://wa.me/79161234567");
  });

  it("formats Telegram link from username with or without @", () => {
    expect(telegramLink("@romashka_salon")).toBe("https://t.me/romashka_salon");
    expect(telegramLink("romashka_salon")).toBe("https://t.me/romashka_salon");
  });

  it("rejects invalid phones and Telegram usernames", () => {
    expect(() => telLink("123")).toThrow(MiniSiteValidationError);
    expect(() => telLink("+7 916 <script>")).toThrow(MiniSiteValidationError);
    expect(() => telegramLink("ab")).toThrow(MiniSiteValidationError);
    expect(() => telegramLink("bad/../name")).toThrow(MiniSiteValidationError);
  });
});

describe("metrikaGoals", () => {
  it("describes every goal used on the page with a Russian name", () => {
    expect(MINI_SITE_GOALS).toEqual(["call", "messenger", "booking", "route"]);
    expect(metrikaGoals()).toEqual([
      { identifier: "call", name: "Звонок", type: "action" },
      { identifier: "messenger", name: "Переход в мессенджер", type: "action" },
      { identifier: "booking", name: "Переход к онлайн-записи", type: "action" },
      { identifier: "route", name: "Построение маршрута", type: "action" },
    ]);
  });
});
