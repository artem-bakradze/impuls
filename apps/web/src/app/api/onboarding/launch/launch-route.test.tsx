import { SIMULATOR_CAPABILITIES } from "@impuls/platforms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountKind } from "@/lib/account-mode";
import { emptyDraft, STEP_COUNT } from "@/lib/onboarding";
import type { OnboardingDraft } from "@/lib/onboarding";

const state = vi.hoisted((): { kind: AccountKind; enqueued: { kind: string; simulation?: true }[]; draft: (draft: OnboardingDraft) => OnboardingDraft } => ({
  kind: "demo",
  enqueued: [],
  draft: (draft) => draft,
}));

const ready = (): OnboardingDraft => {
  const draft = emptyDraft();
  draft.sources.siteUrl = "https://nogotok.example";
  draft.card = { ...draft.card, category: "Маникюр", city: "Москва", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }] };
  draft.budget.monthlyBudgetRub = 15_000;
  draft.ads = { search: [{ title: "Маникюр", text: "У метро" }], network: [] };
  draft.keywords = { search: ["маникюр"], negative: [] };
  draft.directConnected = true;
  return draft;
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/session", () => ({ apiUserId: () => Promise.resolve("u1") }));
vi.mock("@/lib/server/users", () => ({ userKind: () => Promise.resolve(state.kind) }));
vi.mock("@/lib/server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/server/read-context", () => ({ platformCapabilities: () => SIMULATOR_CAPABILITIES }));
vi.mock("@/lib/server/business", () => ({
  findBusiness: () => Promise.resolve({ id: "b1", launchedOn: null, onboardingStep: STEP_COUNT, timeZone: "Europe/Moscow" }),
  readDraft: () => state.draft(ready()),
}));
vi.mock("@/lib/server/jobs", () => ({
  enqueueWebJob: (job: { kind: string; simulation?: true }) => {
    state.enqueued.push(job);
    return Promise.resolve("job-1");
  },
}));

const { POST } = await import("./route");
const launch = (body: unknown) => POST(new Request("http://localhost/api/onboarding/launch", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  state.enqueued = [];
  state.draft = (draft) => draft;
});

describe("POST /api/onboarding/launch: the mode is the account's (simulation-mode «Режим бизнеса «Симуляция»»)", () => {
  it("launches a demo's simulation and the test login's Direct from today's page, which sends no mode", async () => {
    state.kind = "demo";
    expect((await launch({})).status).toBe(200);
    state.kind = "test";
    expect((await launch({})).status).toBe(200);
    expect(state.enqueued.map((job) => job.simulation ?? false)).toEqual([true, false]);
  });

  it("refuses a stale page that asks the test login for the simulation, and enqueues nothing", async () => {
    state.kind = "test";
    const response = await launch({ simulation: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "WIZARD_OUTDATED", message: "Мастер обновился — обновите страницу" });
    expect(state.enqueued).toEqual([]);
  });

  it("accepts a stale page of a demo that asked for the simulation it has anyway", async () => {
    state.kind = "demo";
    expect((await launch({ simulation: true })).status).toBe(200);
    expect(state.enqueued).toMatchObject([{ kind: "launch", simulation: true }]);
  });
});

describe("POST /api/onboarding/launch: the own goal needs its sum (business-onboarding «Выбор бюджета»)", () => {
  it("refuses a draft with «Укажу сумму» and no sum, and enqueues nothing", async () => {
    state.kind = "demo";
    state.draft = (draft) => ({ ...draft, budget: { ...draft.budget, goalMode: "user", goalRub: null } });
    const response = await launch({});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "STEP_INCOMPLETE" });
    expect(state.enqueued).toEqual([]);
  });
});
