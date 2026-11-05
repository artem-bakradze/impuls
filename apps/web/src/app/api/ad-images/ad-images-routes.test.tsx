import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardFactsOf, emptyDraft } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";

const state = vi.hoisted(() => ({
  business: null as { id: string; launchedOn: string | null } | null,
  rows: [] as { businessId: string; png: Uint8Array }[],
  draft: null as OnboardingDraft | null,
  enqueued: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/session", () => ({ apiUserId: () => Promise.resolve("u1") }));
vi.mock("@/lib/server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/business", () => ({ findBusiness: () => Promise.resolve(state.business), readDraft: () => state.draft }));
vi.mock("@/lib/server/runtime", () => ({
  db: () => ({ select: () => ({ from: () => ({ where: () => Promise.resolve(state.rows) }) }) }),
}));
vi.mock("@/lib/server/jobs", () => ({
  enqueueWebJob: (job: unknown) => {
    state.enqueued.push(job);
    return Promise.resolve("job-1");
  },
}));

const { GET } = await import("./[id]/route");
const { POST } = await import("../onboarding/ad-images/route");

const get = (id: string) => GET(new Request(`http://localhost/api/ad-images/${id}`), { params: Promise.resolve({ id }) });
const post = (body: unknown) => POST(new Request("http://localhost/api/onboarding/ad-images", { method: "POST", body: JSON.stringify(body) }));

const confirmedDraft = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.siteUrl = "https://nogotok.example";
  draft.card = { ...draft.card, name: "Ноготок", category: "Маникюр", city: "Москва", address: "Профсоюзная, 1", phone: "+7 900 000-00-00", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }] };
  draft.budget.monthlyBudgetRub = 15_000;
  return draft;
};

beforeEach(() => {
  state.business = { id: "b1", launchedOn: null };
  state.rows = [];
  state.draft = confirmedDraft();
  state.enqueued = [];
});

describe("GET /api/ad-images/:id", () => {
  it("gives the owner the picture as a PNG the browser may keep", async () => {
    state.rows = [{ businessId: "b1", png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47) }];
    const response = await get("img-1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("answers another business's picture exactly like a missing one", async () => {
    state.rows = [{ businessId: "b2", png: Uint8Array.of(1) }];
    const foreign = await get("img-2");
    state.rows = [];
    const missing = await get("img-3");
    for (const response of [foreign, missing]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ code: "IMAGE_NOT_FOUND", message: "Картинка не найдена" });
    }
  });

  it("gives nothing without a business", async () => {
    state.business = null;
    state.rows = [{ businessId: "b1", png: Uint8Array.of(1) }];
    expect((await get("img-1")).status).toBe(404);
  });
});

describe("POST /api/onboarding/ad-images", () => {
  it("queues the pictures with the confirmed card's facts and the ads' titles", async () => {
    const response = await post({ ads: [{ title: "Маникюр рядом", previousImageId: null }, { title: "Маникюр у дома", previousImageId: "img-1" }] });
    expect(await response.json()).toEqual({ jobId: "job-1" });
    expect(state.enqueued).toEqual([
      { kind: "draw_ad_images", businessId: "b1", facts: cardFactsOf(confirmedDraft()), ads: [{ title: "Маникюр рядом", previousImageId: null }, { title: "Маникюр у дома", previousImageId: "img-1" }] },
    ]);
  });

  it("refuses a launched business, an unconfirmed card and a malformed request", async () => {
    state.business = { id: "b1", launchedOn: "2026-11-01" };
    expect((await post({ ads: [{ title: "Маникюр", previousImageId: null }] })).status).toBe(409);
    state.business = { id: "b1", launchedOn: null };
    state.draft = emptyDraft();
    expect((await post({ ads: [{ title: "Маникюр", previousImageId: null }] })).status).toBe(400);
    state.draft = confirmedDraft();
    expect((await post({ ads: [] })).status).toBe(400);
    expect((await post({ ads: [{ title: " ", previousImageId: null }] })).status).toBe(400);
    expect(state.enqueued).toEqual([]);
  });
});
