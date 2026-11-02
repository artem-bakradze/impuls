import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

export const fetchPublicPage = async (raw: string, fetchImpl: typeof fetch = fetch, resolve: Resolver = dnsResolver): Promise<string> => {
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
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > PAGE_MAX_BYTES) {
      throw new PageFetchError("TOO_LARGE", `${url.host} page is larger than ${PAGE_MAX_BYTES} bytes`);
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > PAGE_MAX_BYTES) {
      throw new PageFetchError("TOO_LARGE", `${url.host} page is larger than ${PAGE_MAX_BYTES} bytes`);
    }
    return new TextDecoder("utf-8").decode(body);
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
