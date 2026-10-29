import { describe, expect, it } from "vitest";
import { fetchPublicPage, isPrivateAddress, PAGE_MAX_BYTES } from "./pages";

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
