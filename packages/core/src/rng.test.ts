import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("continues the same sequence from a saved state", () => {
    const rng = createRng(42);
    for (let i = 0; i < 10; i++) rng();
    const restored = createRng(rng.state());
    expect([restored(), restored(), restored()]).toEqual([rng(), rng(), rng()]);
  });
});
