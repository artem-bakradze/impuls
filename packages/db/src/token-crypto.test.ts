import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseTokenKey } from "./token-crypto";

const key = parseTokenKey(randomBytes(32).toString("base64"));

describe("token encryption", () => {
  it("round-trips a token without storing it in clear text", () => {
    const stored = encryptToken(key, "y0_secret-token");
    expect(stored).not.toContain("y0_secret-token");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptToken(key, stored)).toBe("y0_secret-token");
  });

  it("uses a fresh IV for every encryption", () => {
    expect(encryptToken(key, "same")).not.toBe(encryptToken(key, "same"));
  });

  it("refuses another key, a tampered value and a bad key size", () => {
    const stored = encryptToken(key, "token");
    expect(() => decryptToken(parseTokenKey(randomBytes(32).toString("base64")), stored)).toThrow();
    const parts = stored.split(".");
    expect(() => decryptToken(key, [parts[0], parts[1], parts[2], "AAAA"].join("."))).toThrow();
    expect(() => parseTokenKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
