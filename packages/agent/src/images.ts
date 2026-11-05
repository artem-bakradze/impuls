import { deflateSync } from "node:zlib";
import OpenAI from "openai";
import { ProxyAgent } from "undici";
import type { CardFacts } from "./creatives";
import { LlmError } from "./llm";

/**
 * Pictures of the ads on partner sites (ad-creatives spec «Картинки объявлений на сайтах-партнёрах», network-ad-images
 * decision 1). Two engines, chosen like the texts: the image model (`CREATIVES=openai`) or a free deterministic
 * template drawn here without any model.
 */

/** The only facts a picture may be drawn from: public card data, never the owner's name, email or phone. */
export interface ImageFacts {
  category: string;
  services: string[];
  area: string;
  adTitle: string;
}

export interface AdImage {
  png: Uint8Array;
  width: number;
  height: number;
  source: "generated" | "template";
}

export interface ImageEngine {
  /** Whether `draw` calls a paid model, so the monthly limit applies. */
  readonly paid: boolean;
  /** `seed` picks the variant: the same seed gives the same template, «Другая картинка» passes a new one. */
  draw(facts: ImageFacts, seed: number): Promise<AdImage>;
}

export const IMAGE_SIZE = 1024;

export const imageFactsOf = (facts: CardFacts, adTitle: string): ImageFacts => ({
  category: facts.category,
  services: facts.services.map((service) => service.name),
  area: facts.city,
  adTitle,
});

/** FNV-1a: a stable 32-bit hash for hues and first seeds. */
export const hashText = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** The seed of an ad's first picture: the same ad gets the same template. */
export const firstImageSeed = (adTitle: string): number => hashText(adTitle) % 1_000_000;

// --- PNG encoding (RFC 2083) without dependencies -------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** Encodes 8-bit RGB pixels (row-major, 3 bytes each) as a PNG with the «Sub» filter on every row. */
export const encodePng = (width: number, height: number, rgb: Uint8Array): Uint8Array => {
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1;
    for (let x = 0; x < stride; x++) {
      const value = rgb[y * stride + x] as number;
      const left = x >= 3 ? (rgb[y * stride + x - 3] as number) : 0;
      raw[row + 1 + x] = (value - left) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** Width and height from a PNG's IHDR, or null when the bytes are not a PNG. */
export const pngSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

// --- The template picture --------------------------------------------------------------------------------------

/** mulberry32: the template's only source of variety, fully determined by the seed. */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rgb = [number, number, number];

const hsl = (hue: number, saturation: number, lightness: number): Rgb => {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

/** A shape as a signed distance (negative inside), so edges get one pixel of smoothing. */
interface Shape {
  distance: (x: number, y: number) => number;
  color: Rgb;
  alpha: number;
}

const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;
const ring = (cx: number, cy: number, r: number, w: number) => (x: number, y: number) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w;
const band = (angle: number, offset: number, w: number) => {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  return (x: number, y: number) => Math.abs(x * nx + y * ny - offset) - w;
};

const PATTERNS = ["circles", "rings", "bands", "dots"] as const;

const shapesFor = (seed: number, hue: number, size: number): Shape[] => {
  const random = seeded(seed);
  const pattern = PATTERNS[Math.floor(random() * PATTERNS.length)] as (typeof PATTERNS)[number];
  const light: Rgb = hsl(hue + 20, 0.7, 0.85);
  const deep: Rgb = hsl(hue - 25, 0.55, 0.3);
  const tone = (): Rgb => (random() < 0.6 ? light : deep);
  const shapes: Shape[] = [];
  if (pattern === "circles") {
    for (let i = 0; i < 6; i++) {
      shapes.push({ distance: circle(random() * size, random() * size, size * (0.08 + random() * 0.22)), color: tone(), alpha: 0.25 + random() * 0.3 });
    }
  } else if (pattern === "rings") {
    const cx = size * (0.25 + random() * 0.5);
    const cy = size * (0.25 + random() * 0.5);
    for (let i = 0; i < 5; i++) {
      shapes.push({ distance: ring(cx, cy, size * (0.12 + i * 0.11), size * (0.012 + random() * 0.025)), color: tone(), alpha: 0.3 + random() * 0.3 });
    }
  } else if (pattern === "bands") {
    const angle = random() * Math.PI;
    for (let i = 0; i < 5; i++) {
      shapes.push({ distance: band(angle, size * (random() * 1.4 - 0.2), size * (0.02 + random() * 0.07)), color: tone(), alpha: 0.2 + random() * 0.3 });
    }
  } else {
    const step = size / (4 + Math.floor(random() * 3));
    const r = step * (0.12 + random() * 0.15);
    const shift = random() * step;
    for (let y = shift / 2; y < size; y += step) {
      for (let x = shift; x < size; x += step) {
        shapes.push({ distance: circle(x, y, r), color: light, alpha: 0.35 });
      }
    }
  }
  return shapes;
};

/** Draws the template: a gradient in the business's own hue and a pattern picked by the seed. */
export const drawTemplate = (facts: ImageFacts, seed: number, size = IMAGE_SIZE): Uint8Array => {
  const hue = hashText(facts.category.trim().toLowerCase()) % 360;
  const from = hsl(hue, 0.55, 0.62);
  const to = hsl(hue + 35, 0.6, 0.42);
  const shapes = shapesFor(seed, hue, size);
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1));
      let r = from[0] + (to[0] - from[0]) * t;
      let g = from[1] + (to[1] - from[1]) * t;
      let b = from[2] + (to[2] - from[2]) * t;
      for (const shape of shapes) {
        const coverage = Math.min(1, Math.max(0, 0.5 - shape.distance(x, y)));
        if (coverage === 0) continue;
        const a = coverage * shape.alpha;
        r += (shape.color[0] - r) * a;
        g += (shape.color[1] - g) * a;
        b += (shape.color[2] - b) * a;
      }
      const i = (y * size + x) * 3;
      rgb[i] = Math.round(r);
      rgb[i + 1] = Math.round(g);
      rgb[i + 2] = Math.round(b);
    }
  }
  return encodePng(size, size, rgb);
};

/** Free and deterministic: local stands, autotests, and the fallback when the model fails or the limit is spent. */
export class TemplateImageEngine implements ImageEngine {
  readonly paid = false;

  draw(facts: ImageFacts, seed: number): Promise<AdImage> {
    return Promise.resolve({ png: drawTemplate(facts, seed), width: IMAGE_SIZE, height: IMAGE_SIZE, source: "template" });
  }
}

// --- The image model ------------------------------------------------------------------------------------------

/** The part of the OpenAI client the engine uses; tests pass a fake that records the request. */
export interface ImagesApi {
  generate(params: { model: string; prompt: string; size: "1024x1024"; n: 1; output_format: "png" }): Promise<{ data?: { b64_json?: string | null }[] | null }>;
}

export interface OpenAiImageOptions {
  apiKey: string;
  model: string;
  proxyUrl?: string;
  timeoutMs?: number;
  /** Tests only: replaces the OpenAI client. */
  api?: ImagesApi;
}

/** The prompt is built from `ImageFacts` alone, in English, and forbids what moderation and the advertising law reject. */
export const imagePrompt = (facts: ImageFacts): string =>
  [
    "A square advertising picture for a small local business, bright and clean, photo-like or a modern flat illustration.",
    `Business: ${facts.category}.`,
    facts.services.length > 0 ? `Services: ${facts.services.slice(0, 5).join(", ")}.` : "",
    facts.area ? `Area: ${facts.area}.` : "",
    `The ad's headline, for the theme only: «${facts.adTitle}».`,
    "Strictly no text, letters, digits, prices, logos, watermarks or brand names anywhere in the picture, and no close-up faces of people.",
  ]
    .filter((line) => line !== "")
    .join(" ");

export class OpenAiImageEngine implements ImageEngine {
  readonly paid = true;
  private readonly api: ImagesApi;

  constructor(private readonly options: OpenAiImageOptions) {
    if (!options.apiKey || !options.model) {
      throw new Error("OpenAI API key and image model are required for the image engine");
    }
    if (options.api !== undefined) {
      this.api = options.api;
    } else {
      const client = new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? 120_000,
        maxRetries: 0,
        ...(options.proxyUrl !== undefined && { fetchOptions: { dispatcher: new ProxyAgent(options.proxyUrl) } }),
      });
      this.api = { generate: (params) => client.images.generate(params) };
    }
  }

  async draw(facts: ImageFacts): Promise<AdImage> {
    let b64: string | null | undefined;
    try {
      const response = await this.api.generate({ model: this.options.model, prompt: imagePrompt(facts), size: "1024x1024", n: 1, output_format: "png" });
      b64 = response.data?.[0]?.b64_json;
    } catch (error) {
      throw new LlmError("LLM_UNAVAILABLE", `OpenAI image request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!b64) {
      throw new LlmError("LLM_REFUSED", "OpenAI returned no image");
    }
    const png = new Uint8Array(Buffer.from(b64, "base64"));
    const size = pngSize(png);
    if (size === null || size.width !== size.height) {
      throw new LlmError("LLM_INVALID_OUTPUT", "OpenAI returned an image that is not a square PNG");
    }
    return { png, width: size.width, height: size.height, source: "generated" };
  }
}
