import { describe, expect, it } from "vitest";
import { MiniSiteValidationError } from "./errors";
import { InMemoryMiniSiteStore, publishMiniSite, validateSlug } from "./store";

describe("validateSlug", () => {
  it.each(["romashka", "salon-romashka-2", "a", "1"])("accepts %s", (slug) => {
    expect(validateSlug(slug)).toBe(slug);
  });

  it.each(["", "Romashka", "ромашка", "salon_romashka", "-salon", "salon-", "sa--lon", "a/b", "../etc", "a".repeat(64)])(
    "rejects %j with INVALID_SLUG",
    (slug) => {
      expect(() => validateSlug(slug)).toThrow(MiniSiteValidationError);
      try {
        validateSlug(slug);
      } catch (err) {
        expect((err as MiniSiteValidationError).code).toBe("INVALID_SLUG");
      }
    },
  );
});

describe("publishMiniSite", () => {
  it("writes index.html and assets under the slug and invalidates them", async () => {
    const store = new InMemoryMiniSiteStore();
    const paths = await publishMiniSite(store, "romashka", {
      html: "<!doctype html><title>x</title>",
      assets: { "robots.txt": "User-agent: *", "img/logo.svg": "<svg/>" },
    });

    expect(paths).toEqual(["romashka/robots.txt", "romashka/img/logo.svg", "romashka/index.html"]);
    expect(store.objects.get("romashka/index.html")).toEqual({
      body: "<!doctype html><title>x</title>",
      contentType: "text/html; charset=utf-8",
    });
    expect(store.objects.get("romashka/robots.txt")?.contentType).toBe("text/plain; charset=utf-8");
    expect(store.objects.get("romashka/img/logo.svg")?.contentType).toBe("image/svg+xml");
    expect(store.invalidations).toEqual([
      ["romashka/", "romashka/robots.txt", "romashka/img/logo.svg", "romashka/index.html"],
    ]);
  });

  it("writes nothing for an invalid slug", async () => {
    const store = new InMemoryMiniSiteStore();
    await expect(publishMiniSite(store, "Bad Slug", { html: "x", assets: {} })).rejects.toThrow(/Invalid mini-site slug/);
    expect(store.objects.size).toBe(0);
    expect(store.invalidations).toEqual([]);
  });

  it.each(["../other/index.html", "/abs.txt", "index.html", "file.exe"])(
    "rejects unsafe or unsupported asset path %s before writing",
    async (path) => {
      const store = new InMemoryMiniSiteStore();
      await expect(publishMiniSite(store, "romashka", { html: "x", assets: { [path]: "y" } })).rejects.toThrow(
        MiniSiteValidationError,
      );
      expect(store.objects.size).toBe(0);
    },
  );
});
