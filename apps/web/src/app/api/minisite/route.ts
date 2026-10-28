import { z } from "zod";
import { handleApi } from "@/lib/server/errors";
import { enqueueWebJob } from "@/lib/server/jobs";
import { parseBody } from "@/lib/server/request";
import { apiLaunchedBusiness } from "@/lib/server/session";

const Body = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  businessName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(5).max(30),
  address: z.string().trim().min(1).max(200),
  hours: z.string().trim().min(1).max(100),
  telegram: z.string().trim().max(40),
  metrikaCounterId: z.number().int().positive(),
  advertiserName: z.string().trim().min(1).max(200),
  advertiserInn: z.string().regex(/^(\d{10}|\d{12})$/),
  services: z.array(z.object({ name: z.string().trim().min(1).max(100), priceRub: z.number().int().positive() })).min(1).max(20),
});

/** Saves the mini-site (mini-site spec): the worker publishes it statically and logs the change in the history. */
export async function POST(request: Request) {
  return handleApi("minisite.save", async () => {
    const business = await apiLaunchedBusiness();
    const body = await parseBody(request, Body);
    const card = {
      businessName: body.businessName,
      phone: body.phone,
      address: body.address,
      services: body.services.map((s) => ({ name: s.name, price: s.priceRub * 100 })),
      photos: [],
      openingHours: [{ days: body.hours.split(" ")[0] ?? body.hours, hours: body.hours.split(" ").slice(1).join(" ") || body.hours }],
      messengers: body.telegram === "" ? {} : { telegram: body.telegram },
    };
    const jobId = await enqueueWebJob({
      kind: "minisite_save",
      businessId: business.id,
      slug: body.slug,
      card: JSON.stringify(card),
      metrikaCounterId: body.metrikaCounterId,
      advertiser: { name: body.advertiserName, inn: body.advertiserInn },
    });
    return { jobId };
  });
}
