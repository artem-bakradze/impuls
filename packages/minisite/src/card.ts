import type { Kopecks } from "@impuls/core";

export interface MiniSiteService {
  name: string;
  /** Price in kopecks. */
  price: Kopecks;
  /** Render the price as «от …». */
  priceFrom?: boolean;
  description?: string;
}

export interface MiniSitePhoto {
  /** Absolute http(s) URL. */
  url: string;
  /** Intrinsic size in pixels, required to avoid layout shift. */
  width: number;
  height: number;
  alt?: string;
}

export interface MiniSiteOpeningHours {
  /** E.g. «Пн–Пт». */
  days: string;
  /** E.g. «10:00–20:00» or «выходной». */
  hours: string;
}

export interface MiniSiteMessengers {
  /** Phone number linked to WhatsApp. */
  whatsapp?: string;
  /** Telegram username, with or without leading «@». */
  telegram?: string;
}

/** Business card data used to build a mini-site. */
export interface MiniSiteCard {
  businessName: string;
  description?: string;
  /** Phone for the «Позвонить» button, Russian or international format. */
  phone: string;
  services: MiniSiteService[];
  photos: MiniSitePhoto[];
  address: string;
  openingHours: MiniSiteOpeningHours[];
  messengers: MiniSiteMessengers;
  /** Absolute http(s) URL of online booking, if the business has one. */
  bookingUrl?: string;
}

export interface MiniSiteAdvertiser {
  name: string;
  /** 10 digits (organisation) or 12 digits (individual entrepreneur). */
  inn: string;
}

export interface RenderOptions {
  metrikaCounterId: number;
  advertiser: MiniSiteAdvertiser;
}

export interface RenderedMiniSite {
  html: string;
  /** Additional files keyed by path relative to the site root. */
  assets: Record<string, string>;
}
