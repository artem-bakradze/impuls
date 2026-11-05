import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CardFacts } from "./creatives";
import { drawTemplate, encodePng, firstImageSeed, imageFactsOf, OpenAiImageEngine, pngSize, TemplateImageEngine } from "./images";
import type { ImageFacts, ImagesApi } from "./images";
import { LlmError } from "./llm";

const FACTS: ImageFacts = { category: "Маникюрный салон", services: ["Маникюр", "Педикюр"], area: "Казань", adTitle: "Маникюр у дома" };

/** Reads the chunks back and checks each CRC, as a strict PNG decoder would. */
const chunks = (png: Uint8Array): { type: string; data: Buffer }[] => {
  const buffer = Buffer.from(png);
  const out: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    out.push({ type, data });
    offset += 12 + length;
  }
  return out;
};

describe("encodePng", () => {
  it("writes a PNG a decoder reads back pixel for pixel", () => {
    const rgb = Uint8Array.from({ length: 4 * 3 * 3 }, (_, i) => (i * 37) % 256);
    const png = encodePng(4, 3, rgb);
    expect(pngSize(png)).toEqual({ width: 4, height: 3 });
    const parts = chunks(png);
    expect(parts.map((part) => part.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    const raw = inflateSync(parts[1]?.data ?? Buffer.alloc(0));
    // Undo the «Sub» filter of each row.
    const decoded: number[] = [];
    for (let y = 0; y < 3; y++) {
      expect(raw[y * 13]).toBe(1);
      for (let x = 0; x < 12; x++) {
        const left = x >= 3 ? (decoded[y * 12 + x - 3] as number) : 0;
        decoded.push(((raw[y * 13 + 1 + x] as number) + left) & 0xff);
      }
    }
    expect(decoded).toEqual([...rgb]);
  });
});

describe("TemplateImageEngine", () => {
  it("draws a square 1024 × 1024 PNG without a model", async () => {
    const image = await new TemplateImageEngine().draw(FACTS, 1);
    expect(image).toMatchObject({ width: 1024, height: 1024, source: "template" });
    expect(pngSize(image.png)).toEqual({ width: 1024, height: 1024 });
    expect(image.png.length).toBeLessThan(1_000_000);
  });

  it("gives the same picture for the same seed and another pattern for another seed", () => {
    const first = drawTemplate(FACTS, 7, 128);
    expect(Buffer.from(drawTemplate(FACTS, 7, 128)).equals(Buffer.from(first))).toBe(true);
    expect(Buffer.from(drawTemplate(FACTS, 8, 128)).equals(Buffer.from(first))).toBe(false);
  });

  it("keeps the first seed of an ad stable", () => {
    expect(firstImageSeed("Маникюр у дома")).toBe(firstImageSeed("Маникюр у дома"));
    expect(firstImageSeed("Маникюр у дома")).not.toBe(firstImageSeed("Педикюр рядом"));
  });
});

describe("imageFactsOf", () => {
  it("takes the category, services, area and the ad title only", () => {
    const card: CardFacts = {
      name: "Студия Анны Петровой",
      category: "Маникюрный салон",
      services: [{ name: "Маникюр", priceRub: 1500 }],
      address: "ул. Баумана, 5",
      city: "Казань",
      days: "Пн–Вс",
      openFrom: "10:00",
      openTo: "20:00",
      advantages: ["Стерильные инструменты"],
    };
    expect(imageFactsOf(card, "Маникюр у дома")).toEqual({ category: "Маникюрный салон", services: ["Маникюр"], area: "Казань", adTitle: "Маникюр у дома" });
  });
});

describe("OpenAiImageEngine", () => {
  const square = Buffer.from(drawTemplate(FACTS, 1, 64)).toString("base64");

  it("sends only public facts and forbids text in the picture", async () => {
    const requests: Parameters<ImagesApi["generate"]>[0][] = [];
    const api: ImagesApi = {
      generate: (params) => {
        requests.push(params);
        return Promise.resolve({ data: [{ b64_json: square }] });
      },
    };
    const image = await new OpenAiImageEngine({ apiKey: "test", model: "gpt-image-test", api }).draw(FACTS);
    expect(image).toMatchObject({ width: 64, height: 64, source: "generated" });
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toMatchObject({ model: "gpt-image-test", size: "1024x1024", n: 1, output_format: "png" });
    expect(Object.keys(request ?? {}).sort()).toEqual(["model", "n", "output_format", "prompt", "size"]);
    expect(request?.prompt).toContain("Маникюрный салон");
    expect(request?.prompt).toContain("Маникюр, Педикюр");
    expect(request?.prompt).toContain("Казань");
    expect(request?.prompt).toContain("Маникюр у дома");
    expect(request?.prompt).toMatch(/no text, letters, digits, prices, logos/);
  });

  it("turns a failed or empty answer into an LlmError", async () => {
    const failing = new OpenAiImageEngine({ apiKey: "test", model: "m", api: { generate: () => Promise.reject(new Error("timeout")) } });
    await expect(failing.draw(FACTS)).rejects.toBeInstanceOf(LlmError);
    const empty = new OpenAiImageEngine({ apiKey: "test", model: "m", api: { generate: () => Promise.resolve({ data: [] }) } });
    await expect(empty.draw(FACTS)).rejects.toMatchObject({ code: "LLM_REFUSED" });
    const notPng = new OpenAiImageEngine({ apiKey: "test", model: "m", api: { generate: () => Promise.resolve({ data: [{ b64_json: "aGVsbG8=" }] }) } });
    await expect(notPng.draw(FACTS)).rejects.toMatchObject({ code: "LLM_INVALID_OUTPUT" });
  });
});
