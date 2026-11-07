import { IdlePolicy, OpenAiImageEngine, pngSize, QuietPolicy, TemplateCreativeEngine, TemplateImageEngine } from "@impuls/agent";
import type { AdDraft, AgentRuntime, ImagesApi } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { checkModerationAndBalance, CommandExecutor, handleWebJob, launchSimulation, MemoryStore, SimulationDriver } from "@impuls/worker";
import type { AdImageRecord, DrawnImage, DrawnImages, JobContext, LaunchPlan } from "@impuls/worker";

type AdPlatform = ReturnType<JobContext["platformFor"]>;
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { buildLaunchPlan, cardFactsOf, emptyDraft, IMAGE_NOTES, stepProblems } from "../../../apps/web/src/lib/onboarding";
import type { NetworkAdDraft, OnboardingDraft } from "../../../apps/web/src/lib/onboarding";
import { ownerPlan, ownerWorld, PARTNER } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath } from "./world";

const creatives = await loadFeature(featurePath("ad-creatives/images.feature"), { language: "ru" });
const platformImages = await loadFeature(featurePath("platform-integration/images.feature"), { language: "ru" });
const onboarding = await loadFeature(featurePath("business-onboarding/images.feature"), { language: "ru" });
const sheet = await loadFeature(featurePath("analytics/images.feature"), { language: "ru" });

const OWNER_EMAIL = "anna.petrova@example.com";
/** A second partner-site ad the owner added in the preview. */
const SECOND: AdDraft = { title: "Маникюр рядом с домом", text: "Маникюр с покрытием за 1 800 ₽" };
const OWNER_PHONE = "+7 916 123-45-67";
const OWNER_NAME = "Анна Петрова";

/** The wizard's draft of a manicure salon with a confirmed card, its owner's phone and name included. */
const salonDraft = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.siteUrl = "https://nogotok.example/";
  draft.card = {
    ...draft.card,
    name: "Ноготок",
    category: "Маникюрный салон",
    services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }],
    address: "Москва, Профсоюзная, 1",
    city: "Москва",
    phone: OWNER_PHONE,
    openFrom: "10:00",
    openTo: "22:00",
  };
  draft.budget.monthlyBudgetRub = 15_000;
  return draft;
};

/** The image model behind the real engine, answering from a script and keeping every request it got. */
const imageModel = () => {
  const requests: Parameters<ImagesApi["generate"]>[0][] = [];
  let failing = false;
  const api: ImagesApi = {
    generate: async (params) => {
      requests.push(params);
      if (failing) throw new Error("the image model did not answer");
      const picture = await new TemplateImageEngine().draw({ category: "x", services: [], area: "", adTitle: params.prompt }, requests.length);
      return { data: [{ b64_json: Buffer.from(picture.png).toString("base64") }] };
    },
  };
  return { engine: new OpenAiImageEngine({ apiKey: "test", model: "gpt-image-test", api }), requests, fail: () => (failing = true), recover: () => (failing = false) };
};

/** The salon's business before launch, its worker context with the given picture engine. */
const salonWorld = async (images: JobContext["images"], monthly = 30, agent: AgentRuntime = new IdlePolicy()) => {
  const sim = new SimulationDriver({ start: new Date("2026-11-05T09:00:00Z"), seed: 1, agent });
  // The owner's email lives in the store; nothing of it may reach the picture.
  if (sim.store instanceof MemoryStore) sim.store.emails.set("b1", OWNER_EMAIL);
  await sim.store.saveBusiness({
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: 15_000,
    launchedOn: null,
    csoSource: { kind: "auto", reference: rubles(500) },
    miniSite: null,
    leadGoalId: null,
    mode: "direct",
    card: { category: "Маникюрный салон", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "", hours: "Пн–Вс 10:00–22:00", advantages: [], name: "Ноготок", address: "", city: "Москва", siteUrl: "https://nogotok.example/" },
  });
  const ctx: JobContext = { ...sim.ctx, creatives: new TemplateCreativeEngine(), images, ...(images.paid && { imageLimit: { monthly } }) };
  const draft = salonDraft();
  const facts = cardFactsOf(draft);
  /**
   * «Как увидят ваши объявления»: the texts, then their pictures, merged into the draft as the wizard does. The template
   * writes one partner-site ad; `more` are the owner's own additions.
   */
  const prepare = async (more: AdDraft[] = []): Promise<OnboardingDraft> => {
    const written = await ctx.creatives.generate(facts, { search: true, network: true });
    const network = [...written.network, ...more];
    const pictures = await draw(network.map((ad) => ({ title: ad.title, imageId: undefined })));
    return {
      ...draft,
      ads: { search: written.search, network: network.map((ad, i) => ({ ...ad, imageId: pictures[i]?.imageId, imageNote: pictures[i]?.note ?? null })) },
      keywords: { search: written.keywords, negative: written.negativeKeywords },
    };
  };
  const draw = async (ads: Pick<NetworkAdDraft, "title" | "imageId">[]): Promise<DrawnImage[]> =>
    ((await handleWebJob(ctx, { kind: "draw_ad_images", businessId: "b1", facts, ads: ads.map((ad) => ({ title: ad.title, previousImageId: ad.imageId ?? null })) })) as DrawnImages).images;
  /** «Другая картинка» or «Попробовать ещё раз» of one ad: only its picture changes. */
  const redraw = async (ad: NetworkAdDraft): Promise<NetworkAdDraft> => {
    const [picture] = await draw([ad]);
    if (picture === undefined) throw new Error("no picture");
    return { ...ad, imageId: picture.imageId, imageNote: picture.note };
  };
  const image = async (id: string | undefined): Promise<AdImageRecord> => {
    const found = id === undefined ? null : await sim.store.adImage(id);
    if (found === null) throw new Error(`no picture ${id ?? "(none)"}`);
    return found;
  };
  return { sim, ctx, prepare, redraw, image };
};

/** The ad platform with its picture uploads counted. */
const countingUploads = (platform: AdPlatform) => {
  const uploads: string[] = [];
  const counted = new Proxy(platform, {
    get(target, property, receiver) {
      if (property === "uploadImage") {
        return async (png: Uint8Array, name: string) => {
          const hash = await target.uploadImage(png, name);
          uploads.push(hash);
          return hash;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { counted, uploads };
};

/** A salon launched in Direct (the simulator stands in for its API) with one partner-site ad and its picture. */
const launchedSalon = async () => {
  // An agent that decides, so a rejected ad reaches it as for a rejected text.
  const world = await salonWorld(new TemplateImageEngine(), 30, new QuietPolicy());
  const draft = await world.prepare();
  const { counted, uploads } = countingUploads(world.sim.platform);
  const ctx: JobContext = { ...world.ctx, platformFor: () => counted };
  const ads = draft.ads;
  if (ads === null) throw new Error("no ads");
  const plan = buildLaunchPlan({ ...draft, ads: { search: ads.search, network: ads.network.slice(0, 1) } }, "2026-11-05", 300);
  await handleWebJob(ctx, { kind: "launch", businessId: "b1", plan });
  const original = (await world.sim.store.ads("b1")).find((a) => a.imageId !== null && a.imageId !== undefined);
  if (!original) throw new Error("no partner-site ad");
  const executor = new CommandExecutor({ store: world.sim.store, locks: ctx.locks, clock: ctx.clock, platformFor: ctx.platformFor });
  const variant = async () => {
    const result = await executor.execute({
      businessId: "b1",
      command: { type: "StartExperiment", directionId: original.directionId, adId: original.id, kind: "offer", hypothesis: "Проверяем оффер", variant: { title: original.title, text: "Первый визит со скидкой 10%" } },
      actor: "safety_net",
      reasonCode: "SAFETY_START_EXPERIMENT",
      explanation: "Запустил проверку",
    });
    expect(result.status).toBe("applied");
    const created = (await world.sim.store.ads("b1")).find((a) => a.text === "Первый визит со скидкой 10%");
    if (!created) throw new Error("no variant");
    return created;
  };
  return { ...world, ctx, original, uploads, variant };
};

describeFeature(creatives, ({ Scenario }) => {
  Scenario("Картинка к объявлению на сайтах-партнёрах", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let model: ReturnType<typeof imageModel>;
    let draft: OnboardingDraft;
    Given("маникюрный салон с платной генерацией картинок", async () => {
      model = imageModel();
      world = await salonWorld(model.engine);
    });
    When("сервис готовит объявления маникюрного салона для сайтов-партнёров", async () => {
      draft = await world.prepare();
    });
    Then("у каждого объявления одна квадратная картинка по теме маникюра, без текста, цифр и логотипов", async () => {
      const network = draft.ads?.network ?? [];
      expect(network.length).toBeGreaterThan(0);
      expect(new Set(network.map((ad) => ad.imageId)).size).toBe(network.length);
      for (const ad of network) {
        const picture = await world.image(ad.imageId);
        expect(picture.source).toBe("generated");
        expect(pngSize(picture.png)).toEqual({ width: 1024, height: 1024 });
      }
      expect(model.requests).toHaveLength(network.length);
      for (const request of model.requests) {
        expect(request).toMatchObject({ size: "1024x1024", n: 1 });
        expect(request.prompt).toContain("Маникюрный салон");
        expect(request.prompt).toMatch(/no text, letters, digits, prices, logos/);
      }
    });
  });

  Scenario("Другая картинка", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let before: NetworkAdDraft;
    let after: NetworkAdDraft;
    Given("маникюрный салон без платной генерации картинок, и у объявления на сайтах-партнёрах уже есть картинка", async () => {
      world = await salonWorld(new TemplateImageEngine());
      const first = (await world.prepare()).ads?.network[0];
      if (!first?.imageId) throw new Error("no picture");
      before = first;
    });
    When("владелец нажимает «Другая картинка» у объявления на сайтах-партнёрах", async () => {
      after = await world.redraw(before);
    });
    Then("картинка заменяется новой, а заголовок и текст объявления прежние", async () => {
      expect(after.imageId).not.toBe(before.imageId);
      expect(Buffer.from((await world.image(after.imageId)).png).equals(Buffer.from((await world.image(before.imageId)).png))).toBe(false);
      expect({ title: after.title, text: after.text }).toEqual({ title: before.title, text: before.text });
    });
  });

  Scenario("Без платной генерации", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let model: ReturnType<typeof imageModel>;
    let draft: OnboardingDraft;
    Given("маникюрный салон без платной генерации картинок", async () => {
      model = imageModel();
      world = await salonWorld(new TemplateImageEngine());
    });
    When("сервис работает с шаблонными текстами", async () => {
      draft = await world.prepare();
    });
    Then("у объявлений на сайтах-партнёрах — картинки-шаблоны, модель картинок не вызывается, а «Другая картинка» даёт другой узор", async () => {
      const network = draft.ads?.network ?? [];
      expect(network.length).toBeGreaterThan(0);
      for (const ad of network) {
        expect(ad.imageNote).toBeNull();
        expect((await world.image(ad.imageId)).source).toBe("template");
      }
      expect(model.requests).toEqual([]);
      const first = network[0] as NetworkAdDraft;
      const other = await world.redraw(first);
      expect(Buffer.from((await world.image(other.imageId)).png).equals(Buffer.from((await world.image(first.imageId)).png))).toBe(false);
    });
  });

  Scenario("Генерация не удалась", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let model: ReturnType<typeof imageModel>;
    let draft: OnboardingDraft;
    Given("маникюрный салон с платной генерацией картинок", async () => {
      model = imageModel();
      world = await salonWorld(model.engine);
    });
    When("модель картинок не ответила", async () => {
      model.fail();
      draft = await world.prepare();
    });
    Then("у объявления картинка-шаблон и сообщение «Не получилось нарисовать картинку — показываем простую» с «Попробовать ещё раз», а «Запустить» доступна", async () => {
      const ad = draft.ads?.network[0] as NetworkAdDraft;
      expect((await world.image(ad.imageId)).source).toBe("template");
      expect(ad.imageNote).toBe("failed");
      expect(IMAGE_NOTES[ad.imageNote ?? "limit"]).toBe("Не получилось нарисовать картинку — показываем простую");
      // The picture is no reason to hold the launch: the step has nothing to fix.
      expect(stepProblems(3, draft)).toEqual([]);
      // «Попробовать ещё раз» asks the model once more, on the owner's click only.
      const asked = model.requests.length;
      model.recover();
      const retried = await world.redraw(ad);
      expect(model.requests).toHaveLength(asked + 1);
      expect(retried.imageNote).toBeNull();
      expect((await world.image(retried.imageId)).source).toBe("generated");
    });
  });

  Scenario("Только публичные данные", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let model: ReturnType<typeof imageModel>;
    Given("маникюрный салон с платной генерацией картинок", async () => {
      model = imageModel();
      world = await salonWorld(model.engine);
    });
    When("автотест перехватывает запрос к модели картинок", async () => {
      await world.prepare();
    });
    Then("в нём только категория, услуги, район и заголовок объявления, без имени и почты владельца и без телефона", () => {
      expect(model.requests.length).toBeGreaterThan(0);
      for (const request of model.requests) {
        expect(Object.keys(request).sort()).toEqual(["model", "n", "output_format", "prompt", "size"]);
        expect(request.prompt).toContain("Маникюрный салон");
        expect(request.prompt).toContain("Маникюр с покрытием");
        expect(request.prompt).toContain("Москва");
        for (const personal of [OWNER_NAME, "Петров", OWNER_EMAIL, OWNER_PHONE, "916", "Профсоюзная"]) {
          expect(request.prompt).not.toContain(personal);
        }
      }
    });
  });

  Scenario("Вариант с той же картинкой", ({ Given, When, Then }) => {
    let salon: Awaited<ReturnType<typeof launchedSalon>>;
    let variant: Awaited<ReturnType<Awaited<ReturnType<typeof launchedSalon>>["variant"]>>;
    Given("запущенная реклама салона с объявлением на сайтах-партнёрах и его картинкой", async () => {
      salon = await launchedSalon();
    });
    When("сервис создаёт новый вариант объявления на сайтах-партнёрах для проверки", async () => {
      variant = await salon.variant();
    });
    Then("у варианта та же картинка, а отличается только текст", () => {
      expect(variant.imageId).toBe(salon.original.imageId);
      expect(variant.title).toBe(salon.original.title);
      expect(variant.text).not.toBe(salon.original.text);
    });
  });

  Scenario("Лимит картинок", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let model: ReturnType<typeof imageModel>;
    let redrawn: NetworkAdDraft;
    Given("маникюрный салон с платной генерацией картинок", async () => {
      model = imageModel();
      world = await salonWorld(model.engine, 2);
    });
    When("бизнес в этом месяце исчерпал лимит платных картинок, и владелец нажимает «Другая картинка»", async () => {
      const old = { businessId: "b1", png: Uint8Array.of(1), width: 1024, height: 1024, source: "generated" as const, seed: 1 };
      await world.sim.store.saveAdImage({ ...old, id: "img-a", createdAt: new Date("2026-11-02T10:00:00Z") });
      await world.sim.store.saveAdImage({ ...old, id: "img-b", createdAt: new Date("2026-11-03T10:00:00Z") });
      redrawn = await world.redraw({ title: "Маникюр рядом с домом", text: "Работаем до 22:00", imageId: "img-b", imageNote: null });
    });
    Then("объявление получает картинку-шаблон и сообщение «Лимит картинок на этот месяц исчерпан — показываем простую»", async () => {
      expect((await world.image(redrawn.imageId)).source).toBe("template");
      expect(redrawn.imageNote).toBe("limit");
      expect(IMAGE_NOTES.limit).toBe("Лимит картинок на этот месяц исчерпан — показываем простую");
      expect(model.requests).toEqual([]);
    });
  });
});

describeFeature(platformImages, ({ Scenario }) => {
  Scenario("Запуск с картинками", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let plan: LaunchPlan;
    let uploads: string[];
    let counted: AdPlatform;
    Given("владелец салона в Москве с сайтом https://nogotok.example/ и двумя объявлениями на сайтах-партнёрах с картинками", async () => {
      world = await salonWorld(new TemplateImageEngine());
      const draft = await world.prepare([SECOND]);
      const ads = draft.ads;
      if (ads === null) throw new Error("no ads");
      plan = buildLaunchPlan({ ...draft, ads: { search: ads.search, network: ads.network.slice(0, 2) } }, "2026-11-05", 300);
      ({ counted, uploads } = countingUploads(world.sim.platform));
    });
    When("владелец запускает рекламу в Директе с двумя объявлениями на сайтах-партнёрах", async () => {
      await handleWebJob({ ...world.ctx, platformFor: () => counted }, { kind: "launch", businessId: "b1", plan });
    });
    Then("обе картинки загружены в библиотеку изображений рекламодателя, а оба объявления созданы текстово-графическими с ними и отправлены на модерацию", async () => {
      expect(uploads).toHaveLength(2);
      const network = (await world.sim.store.directions("b1")).find((d) => d.channel === "network");
      const platformAds = await world.sim.platform.getAds([network?.platformCampaignId ?? ""]);
      expect(platformAds.map((a) => a.imageHash).sort()).toEqual([...uploads].sort());
      // The Direct adapter sends every new ad to moderation (adapter tests); the training market moderates at once.
      expect(platformAds.every((a) => a.moderation === "pending" || a.moderation === "accepted")).toBe(true);
    });
  });

  Scenario("Вариант с той же картинкой", ({ Given, When, Then }) => {
    let salon: Awaited<ReturnType<typeof launchedSalon>>;
    let variant: Awaited<ReturnType<Awaited<ReturnType<typeof launchedSalon>>["variant"]>>;
    let uploadsBefore = 0;
    Given("запущенная реклама салона с объявлением на сайтах-партнёрах и его картинкой", async () => {
      salon = await launchedSalon();
      uploadsBefore = salon.uploads.length;
    });
    When("сервис создаёт вариант объявления на сайтах-партнёрах для проверки", async () => {
      variant = await salon.variant();
    });
    Then("вариант создан с картинкой исходного объявления, и новой загрузки картинки нет", async () => {
      expect(variant.imageHash).toBe(salon.original.imageHash);
      const onPlatform = (await salon.sim.platform.getAds([(await salon.sim.store.directions("b1")).find((d) => d.id === variant.directionId)?.platformCampaignId ?? ""])).find((a) => a.id === variant.platformAdId);
      expect(onPlatform?.imageHash).toBe(salon.original.imageHash);
      expect(salon.uploads).toHaveLength(uploadsBefore);
    });
  });

  Scenario("Картинка в симуляции", ({ Given, When, Then }) => {
    let world: OwnerWorld;
    Given("владелец выбрал симуляцию", async () => {
      world = await ownerWorld(undefined, { launch: false });
    });
    When("владелец запускает симуляцию с объявлениями на сайтах-партнёрах", async () => {
      await launchSimulation(world.ctx, "b1", ownerPlan);
    });
    Then("объявления создаются на учебном рынке с картинками, в API Директа не уходит ни одного запроса, а лист объявлений показывает картинки", async () => {
      const partner = (await world.store.ads("b1")).find((a) => a.title === PARTNER);
      expect(partner?.imageId).toBeTruthy();
      expect(partner?.imageHash).toMatch(/^sim-/);
      expect(world.directCalls).toEqual([]);
      const shown = (await world.work()).shown.find((a) => a.title === PARTNER);
      expect(shown?.imageId).toBe(partner?.imageId);
    });
  });

  Scenario("Картинку отклонила модерация", ({ Given, When, Then }) => {
    let salon: Awaited<ReturnType<typeof launchedSalon>>;
    Given("запущенная реклама салона с объявлением на сайтах-партнёрах и его картинкой", async () => {
      salon = await launchedSalon();
    });
    When("Директ отклонил объявление из-за картинки", async () => {
      salon.sim.platform.moderate(salon.original.platformAdId, "rejected", "изображение не соответствует требованиям к рекламе");
      await checkModerationAndBalance(salon.ctx, "b1");
    });
    Then("владелец видит причину простыми словами, а сервис готовит исправленный вариант, как при отклонённом тексте", async () => {
      const note = (await salon.sim.store.notifications("b1")).find((n) => n.kind === "moderation_rejected");
      expect(note?.message).toBe(`Яндекс не пропустил объявление «${salon.original.title}»: изображение не соответствует требованиям к рекламе. Я подготовлю исправленный вариант.`);
      expect((await salon.sim.store.pendingInbox("b1")).map((e) => e.trigger)).toContainEqual({ kind: "moderation_rejected", adIds: [salon.original.id] });
    });
  });
});

describeFeature(onboarding, ({ Scenario }) => {
  Scenario("Объявление на сайтах-партнёрах с картинкой", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof salonWorld>>;
    let draft: OnboardingDraft;
    Given("владелец подтвердил карточку маникюрного салона", async () => {
      world = await salonWorld(new TemplateImageEngine());
      expect(stepProblems(2, salonDraft())).toEqual([]);
    });
    When("владелец дошёл до шага «Объявления и запуск»", async () => {
      draft = await world.prepare([SECOND]);
    });
    Then("у каждого объявления на сайтах-партнёрах — его картинка и три значка «Изменить», «Другая картинка» и «Убрать» в один ряд, без подписей", async () => {
      const network = draft.ads?.network ?? [];
      expect(network.length).toBeGreaterThan(1);
      expect(new Set(network.map((ad) => ad.imageId)).size).toBe(network.length);
      for (const ad of network) expect((await world.image(ad.imageId)).businessId).toBe("b1");
      // Each picture can be replaced on its own: the icons without words and their names are checked in the preview's
      // component test, the one row at 360 px in the e2e.
      const other = await world.redraw(network[1] as NetworkAdDraft);
      expect(other.imageId).not.toBe(network[1]?.imageId);
    });
  });
});

describeFeature(sheet, ({ Scenario }) => {
  Scenario("Картинка в листе объявлений", ({ Given, When, Then }) => {
    let world: OwnerWorld;
    let shown: Awaited<ReturnType<OwnerWorld["work"]>>["shown"];
    Given("реклама в симуляции с объявлениями в поиске и на сайтах-партнёрах", async () => {
      world = await ownerWorld();
    });
    When("владелец открывает лист «Объявления», а у рекламы есть объявления на сайтах-партнёрах", async () => {
      shown = (await world.work()).shown;
      expect(shown.some((a) => a.channel === "network")).toBe(true);
    });
    Then("у каждого такого объявления видна его картинка рядом с заголовком и текстом", async () => {
      for (const ad of shown) {
        if (ad.channel === "network") {
          expect(ad.imageId).not.toBeNull();
          expect((await world.store.adImage(ad.imageId ?? ""))?.businessId).toBe("b1");
        } else {
          expect(ad.imageId).toBeNull();
        }
      }
    });
  });
});
