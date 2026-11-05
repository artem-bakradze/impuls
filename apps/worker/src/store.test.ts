import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store";

describe("MemoryStore ad pictures", () => {
  it("keeps a picture and counts the paid ones of a business since a date", async () => {
    const store = new MemoryStore();
    const image = { id: "img-1", businessId: "b1", png: Uint8Array.of(1, 2, 3), width: 1024, height: 1024, source: "generated" as const, seed: 1, createdAt: new Date("2026-11-03T10:00:00Z") };
    await store.saveAdImage(image);
    await store.saveAdImage({ ...image, id: "img-2", createdAt: new Date("2026-10-31T10:00:00Z") });
    await store.saveAdImage({ ...image, id: "img-3", source: "template" });
    await store.saveAdImage({ ...image, id: "img-4", businessId: "b2" });

    expect(await store.adImage("img-1")).toEqual(image);
    expect(await store.adImage("missing")).toBeNull();
    expect(await store.generatedImageTimes("b1", new Date("2026-11-01T00:00:00Z"))).toEqual([image.createdAt]);
    expect(await store.generatedImageTimes("b1", new Date("2026-10-01T00:00:00Z"))).toHaveLength(2);
  });
});
