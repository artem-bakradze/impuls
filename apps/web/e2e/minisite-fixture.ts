import { createServer } from "node:http";
import type { Server } from "node:http";
import { InMemoryMiniSiteStore, publishMiniSite, renderMiniSite } from "@impuls/minisite";

/** A published mini-site served as plain static files — no Next.js, no worker (design decision 16). */
export const startStaticMiniSite = async (port: number): Promise<{ url: string; server: Server }> => {
  const store = new InMemoryMiniSiteStore();
  const rendered = renderMiniSite(
    {
      businessName: "Салон «Ноготки»",
      description: "Маникюр и педикюр у метро Профсоюзная",
      phone: "+7 900 123-45-67",
      services: [
        { name: "Маникюр с покрытием", price: 180_000 },
        { name: "Педикюр", price: 250_000, priceFrom: true },
      ],
      photos: [],
      address: "Москва, Профсоюзная улица, 1",
      openingHours: [{ days: "Пн–Вс", hours: "10:00–22:00" }],
      messengers: { whatsapp: "+7 900 123-45-67", telegram: "nogotki_salon" },
      bookingUrl: "https://example.com/booking",
    },
    { metrikaCounterId: 12345678, advertiser: { name: "ИП Иванова А. А.", inn: "771234567890" } },
  );
  await publishMiniSite(store, "nogotki", rendered);
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").replace(/^\//, "").replace(/\/$/, "/index.html");
    const object = store.objects.get(path);
    if (!object) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": object.contentType, "cache-control": "public, max-age=300" }).end(object.body);
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return { url: `http://localhost:${port}/nogotki/`, server };
};
