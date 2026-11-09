import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";

/**
 * Downloads a public page the owner pointed to (site, Yandex Maps, VK) for card extraction. The URL comes from the
 * user, so only http(s) to public addresses is allowed (no SSRF into the worker's network), with a timeout, a size
 * cap and manual redirects that are checked again.
 */
export const PAGE_TIMEOUT_MS = 10_000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class PageFetchError extends Error {
  constructor(
    readonly code: "BAD_URL" | "PRIVATE_ADDRESS" | "HTTP_STATUS" | "NOT_HTML" | "TOO_LARGE" | "NETWORK",
    message: string,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges, IPv4 and IPv6. */
export const isPrivateAddress = (address: string): boolean => {
  const mapped = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(mapped) === 4) {
    const [a = 0, b = 0] = mapped.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return mapped === "::" || mapped === "::1" || /^f[cd]/.test(mapped) || /^fe[89ab]/.test(mapped) || mapped.startsWith("ff");
};

export type Resolver = (host: string) => Promise<string[]>;

const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

const DohAnswer = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

/**
 * Resolves through the JSON API of DNS over HTTPS (`https://dns.google/resolve`, `https://cloudflare-dns.com/dns-query`).
 * For a stand behind a VPN with fake-IP DNS: it answers every host with a reserved address and intercepts plain DNS
 * to any server, so the public-address check would refuse every site; HTTPS to the resolver is not intercepted.
 */
export const dnsOverHttpsResolver = (endpoint: string, fetchImpl: typeof fetch = fetch): Resolver => async (host) => {
  const addresses: string[] = [];
  for (const type of [1, 28]) {
    const url = new URL(endpoint);
    url.searchParams.set("name", host);
    url.searchParams.set("type", String(type));
    const response = await fetchImpl(url, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`DNS over HTTPS answered HTTP ${response.status}`);
    }
    const answer = DohAnswer.parse(await response.json());
    if (answer.Status !== 0) {
      throw new Error(`DNS over HTTPS status ${answer.Status} for ${host}`);
    }
    // CNAME records come in the same answer; only the addresses of the asked type count.
    addresses.push(...(answer.Answer ?? []).filter((record) => record.type === type && isIP(record.data) !== 0).map((record) => record.data));
  }
  if (addresses.length === 0) {
    throw new Error(`${host} has no addresses`);
  }
  return addresses;
};

const checkUrl = async (raw: string, resolve: Resolver): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PageFetchError("BAD_URL", `Not a URL: ${raw}`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new PageFetchError("BAD_URL", `Only public http(s) URLs are fetched: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => {
    throw new PageFetchError("NETWORK", `Cannot resolve ${host}`);
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new PageFetchError("PRIVATE_ADDRESS", `${host} resolves to a non-public address`);
  }
  return url;
};

/** At most PAGE_MAX_BYTES of the body, and whether that is all of it; the rest of a longer page is not downloaded. */
const readCapped = async (body: ReadableStream<Uint8Array> | null): Promise<{ bytes: Uint8Array; whole: boolean }> => {
  if (body === null) return { bytes: new Uint8Array(), whole: true };
  const reader = body.getReader();
  const bytes = new Uint8Array(PAGE_MAX_BYTES);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: bytes.subarray(0, size), whole: true };
    const room = PAGE_MAX_BYTES - size;
    if (value.byteLength > room) {
      bytes.set(value.subarray(0, room), size);
      await reader.cancel();
      return { bytes, whole: false };
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
};

/**
 * `partial`: a page longer than PAGE_MAX_BYTES gives its first PAGE_MAX_BYTES instead of TOO_LARGE. The card reads the
 * beginning of a heavy page (a Wix site is ≈2.6 MB, mostly scripts); the Metrica check needs the whole page.
 */
export const fetchPublicPage = async (
  raw: string,
  fetchImpl: typeof fetch = fetch,
  resolve: Resolver = dnsResolver,
  options: { partial?: boolean } = {},
): Promise<string> => {
  let url = await checkUrl(raw, resolve);
  for (let hop = 0; ; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { "User-Agent": "ImpulsBot/1.0 (+card extraction for the business owner)", Accept: "text/html" },
      });
    } catch (error) {
      throw new PageFetchError("NETWORK", `Fetching ${url.host} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) {
        throw new PageFetchError("HTTP_STATUS", `Too many redirects from ${url.host}`);
      }
      url = await checkUrl(new URL(location, url).toString(), resolve);
      continue;
    }
    if (!response.ok) {
      throw new PageFetchError("HTTP_STATUS", `${url.host} answered HTTP ${response.status}`);
    }
    if (!(response.headers.get("content-type") ?? "").includes("html")) {
      throw new PageFetchError("NOT_HTML", `${url.host} did not return an HTML page`);
    }
    const tooLarge = new PageFetchError("TOO_LARGE", `${url.host} page is larger than ${PAGE_MAX_BYTES} bytes`);
    if (options.partial !== true && Number(response.headers.get("content-length") ?? 0) > PAGE_MAX_BYTES) {
      throw tooLarge;
    }
    const { bytes, whole } = await readCapped(response.body);
    if (!whole && options.partial !== true) {
      throw tooLarge;
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
};

/** Ways a Yandex Metrica counter number appears in a page: the tag snippet, the noscript pixel, old code and Tilda. */
const COUNTER_ID_PATTERNS = [
  /\bym\(\s*['"]?(\d{4,12})['"]?\s*,\s*['"]init['"]/,
  /mc\.yandex\.(?:ru|com|by|kz)\/watch\/(\d{4,12})/,
  /\byaCounter(\d{4,12})\b/,
  /\bmainMetrikaId\s*=\s*['"]?(\d{4,12})/,
];
const COUNTER_SCRIPT = /mc\.yandex\.(?:ru|com|by|kz)\/metrika\/(?:tag|watch)\.js/;

/** Whether the page has Yandex Metrica code, and the counter number when the code names it. */
export const findMetrikaCounter = (html: string): { found: boolean; counterId: number | null } => {
  for (const pattern of COUNTER_ID_PATTERNS) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      return { found: true, counterId: Number(match[1]) };
    }
  }
  return { found: COUNTER_SCRIPT.test(html), counterId: null };
};
