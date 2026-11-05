import { describe, expect, it } from "vitest";
import { dnsOverHttpsResolver, fetchPublicPage, findMetrikaCounter, isPrivateAddress, PAGE_MAX_BYTES } from "./pages";
import { checkCounter } from "./web-jobs";

const publicDns = (host: string) => Promise.resolve(host === "intranet.example" ? ["10.0.0.5"] : ["93.184.216.34"]);
const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "77.88.55.88", "2a02:6b8::2:242"])("treats %s as public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("fetchPublicPage", () => {
  it("downloads a public HTML page", async () => {
    expect(await fetchPublicPage("https://nogotok.example/", () => Promise.resolve(html("<h1>Ноготок</h1>")), publicDns)).toBe("<h1>Ноготок</h1>");
  });

  it("refuses internal addresses, other schemes and credentials before any request", async () => {
    let requests = 0;
    const fetchImpl = () => {
      requests++;
      return Promise.resolve(html(""));
    };
    await expect(fetchPublicPage("http://intranet.example/", fetchImpl, publicDns)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(fetchPublicPage("http://169.254.169.254/latest/meta-data", fetchImpl, publicDns)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(fetchPublicPage("file:///etc/passwd", fetchImpl, publicDns)).rejects.toMatchObject({ code: "BAD_URL" });
    await expect(fetchPublicPage("https://user:pass@nogotok.example/", fetchImpl, publicDns)).rejects.toMatchObject({ code: "BAD_URL" });
    expect(requests).toBe(0);
  });

  it("checks every redirect target again", async () => {
    const fetchImpl = () => Promise.resolve(new Response(null, { status: 302, headers: { location: "http://intranet.example/admin" } }));
    await expect(fetchPublicPage("https://nogotok.example/", fetchImpl, publicDns)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  it("refuses error statuses, non-HTML and oversized pages", async () => {
    await expect(fetchPublicPage("https://a.example/", () => Promise.resolve(html("", { status: 404 })), publicDns)).rejects.toMatchObject({ code: "HTTP_STATUS" });
    await expect(fetchPublicPage("https://a.example/", () => Promise.resolve(new Response("{}", { headers: { "content-type": "application/json" } })), publicDns)).rejects.toMatchObject({ code: "NOT_HTML" });
    await expect(fetchPublicPage("https://a.example/", () => Promise.resolve(html("а".repeat(PAGE_MAX_BYTES))), publicDns)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });
});

describe("dnsOverHttpsResolver", () => {
  const doh = (answers: Record<string, unknown>) => {
    const asked: string[] = [];
    const fetchImpl = (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input);
      asked.push(`${url.searchParams.get("name")}/${url.searchParams.get("type")}`);
      return Promise.resolve(Response.json(answers[url.searchParams.get("type") ?? ""] ?? { Status: 0 }));
    };
    return { fetchImpl, asked };
  };

  it("returns the IPv4 and IPv6 addresses and skips CNAME records", async () => {
    const { fetchImpl, asked } = doh({
      "1": { Status: 0, Answer: [{ type: 5, data: "nogotok.example." }, { type: 1, data: "93.184.216.34" }] },
      "28": { Status: 0, Answer: [{ type: 28, data: "2a02:6b8::2:242" }] },
    });
    expect(await dnsOverHttpsResolver("https://dns.example/resolve", fetchImpl)("nogotok.example")).toEqual(["93.184.216.34", "2a02:6b8::2:242"]);
    expect(asked).toEqual(["nogotok.example/1", "nogotok.example/28"]);
  });

  it("fails for an unknown host and a host without addresses", async () => {
    await expect(dnsOverHttpsResolver("https://dns.example/resolve", doh({ "1": { Status: 3 } }).fetchImpl)("nope.example")).rejects.toThrow("status 3");
    await expect(dnsOverHttpsResolver("https://dns.example/resolve", doh({}).fetchImpl)("empty.example")).rejects.toThrow("no addresses");
  });

  it("lets the public-address check see the real address behind a fake-IP VPN, and still refuses internal ones", async () => {
    const resolve = dnsOverHttpsResolver("https://dns.example/resolve", doh({ "1": { Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] } }).fetchImpl);
    expect(await fetchPublicPage("https://nogotok.example/", () => Promise.resolve(html("<h1>Ноготок</h1>")), resolve)).toBe("<h1>Ноготок</h1>");
    const internal = dnsOverHttpsResolver("https://dns.example/resolve", doh({ "1": { Status: 0, Answer: [{ type: 1, data: "10.0.0.5" }] } }).fetchImpl);
    await expect(fetchPublicPage("https://intranet.example/", () => Promise.resolve(html("")), internal)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });
});

describe("findMetrikaCounter", () => {
  it("finds the counter number in the tag snippet, the pixel, old code and Tilda settings", () => {
    expect(findMetrikaCounter(`<script>ym(12345678, "init", { clickmap: true });</script>`)).toEqual({ found: true, counterId: 12345678 });
    expect(findMetrikaCounter(`<noscript><img src="https://mc.yandex.ru/watch/87654321" /></noscript>`)).toEqual({ found: true, counterId: 87654321 });
    expect(findMetrikaCounter(`var yaCounter4433221 = new Ya.Metrika({id: 4433221});`)).toEqual({ found: true, counterId: 4433221 });
    expect(findMetrikaCounter(`window.mainMetrikaId = '99887766';`)).toEqual({ found: true, counterId: 99887766 });
  });

  it("sees the code without a number and reports a page without Metrica", () => {
    expect(findMetrikaCounter(`<script src="https://mc.yandex.ru/metrika/tag.js"></script>`)).toEqual({ found: true, counterId: null });
    expect(findMetrikaCounter(`<h1>Ноготок</h1><script src="https://www.googletagmanager.com/gtag/js"></script>`)).toEqual({ found: false, counterId: null });
  });
});

describe("checkCounter", () => {
  it("reports found, not found and an unreachable site without throwing", async () => {
    expect(await checkCounter("https://nogotok.example", () => Promise.resolve(`ym(12345678, "init", {})`))).toEqual({ status: "found", counterId: 12345678 });
    expect(await checkCounter("https://nogotok.example", () => Promise.resolve("<h1>Ноготок</h1>"))).toEqual({ status: "not_found" });
    expect(await checkCounter("https://nogotok.example", () => Promise.reject(new Error("timeout")))).toEqual({ status: "unreachable" });
  });
});
