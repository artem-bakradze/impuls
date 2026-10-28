import type { MiniSiteCard, MiniSitePhoto, MiniSiteService, RenderedMiniSite, RenderOptions } from "./card";
import { MiniSiteValidationError } from "./errors";
import { escapeHtml, safeUrl } from "./escape";
import type { MiniSiteGoalId } from "./goals";

const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
const INN = /^(\d{10}|\d{12})$/;

/** Normalizes a phone number to international digits without «+», e.g. `79161234567`. */
export const normalizePhone = (value: string, field: string): string => {
  const compact = value.replace(/[\s()\-.]/g, "");
  if (/^8\d{10}$/.test(compact)) return `7${compact.slice(1)}`;
  if (/^7\d{10}$/.test(compact)) return compact;
  if (/^\+\d{10,15}$/.test(compact)) return compact.slice(1);
  throw new MiniSiteValidationError("INVALID_PHONE", `${field} is not a valid phone number`);
};

export const telLink = (phone: string): string => `tel:+${normalizePhone(phone, "phone")}`;

export const whatsappLink = (phone: string): string => `https://wa.me/${normalizePhone(phone, "messengers.whatsapp")}`;

export const telegramLink = (username: string): string => {
  const name = username.startsWith("@") ? username.slice(1) : username;
  if (!TELEGRAM_USERNAME.test(name)) {
    throw new MiniSiteValidationError("INVALID_TELEGRAM_USERNAME", "messengers.telegram is not a valid username");
  }
  return `https://t.me/${name}`;
};

export const yandexMapEmbedUrl = (address: string): string =>
  `https://yandex.ru/map-widget/v1/?text=${encodeURIComponent(address)}&z=16`;

export const yandexRouteUrl = (address: string): string =>
  `https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtt=auto`;

const rubleFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

const formatPrice = (service: MiniSiteService): string => {
  const amount = `${rubleFormat.format(service.price / 100)} ₽`;
  return service.priceFrom === true ? `от ${amount}` : amount;
};

const requireText = (value: string, field: string): string => {
  if (value.trim() === "") throw new MiniSiteValidationError("INVALID_CARD", `${field} must not be empty`);
  return value;
};

const validateOptions = (options: RenderOptions): void => {
  if (!Number.isInteger(options.metrikaCounterId) || options.metrikaCounterId <= 0) {
    throw new MiniSiteValidationError("INVALID_COUNTER_ID", "metrikaCounterId must be a positive integer");
  }
  if (options.advertiser.name.trim() === "") {
    throw new MiniSiteValidationError("INVALID_ADVERTISER", "advertiser.name must not be empty");
  }
  if (!INN.test(options.advertiser.inn)) {
    throw new MiniSiteValidationError("INVALID_ADVERTISER", "advertiser.inn must be 10 or 12 digits");
  }
};

const goalAttr = (goal: MiniSiteGoalId): string => ` data-goal="${goal}"`;

const externalLink = (href: string, label: string, goal: MiniSiteGoalId, cls: string): string =>
  `<a class="${cls}" href="${escapeHtml(href)}"${goalAttr(goal)} target="_blank" rel="noopener noreferrer">${label}</a>`;

const renderPhoto = (photo: MiniSitePhoto, index: number, fallbackAlt: string): string => {
  if (!Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width <= 0 || photo.height <= 0) {
    throw new MiniSiteValidationError("INVALID_CARD", `photos[${index}] must have positive integer width and height`);
  }
  const src = safeUrl(photo.url, `photos[${index}].url`);
  const loading = index === 0 ? "eager" : "lazy";
  // alt falls back to the business name: presentation-only label.
  const alt = photo.alt ?? fallbackAlt;
  return `<img src="${escapeHtml(src)}" width="${photo.width}" height="${photo.height}" alt="${escapeHtml(alt)}" loading="${loading}" decoding="async">`;
};

const renderServices = (services: MiniSiteService[]): string => {
  if (services.length === 0) return "";
  const items = services
    .map((service, index) => {
      if (!Number.isFinite(service.price) || service.price < 0) {
        throw new MiniSiteValidationError("INVALID_CARD", `services[${index}].price must be a non-negative number`);
      }
      const description =
        service.description === undefined ? "" : `<p class="muted">${escapeHtml(service.description)}</p>`;
      return `<li><div><h3>${escapeHtml(requireText(service.name, `services[${index}].name`))}</h3>${description}</div><strong>${formatPrice(service)}</strong></li>`;
    })
    .join("");
  return `<section aria-labelledby="services"><h2 id="services">Услуги и цены</h2><ul class="services">${items}</ul></section>`;
};

const renderHours = (card: MiniSiteCard): string => {
  if (card.openingHours.length === 0) return "";
  const rows = card.openingHours
    .map((row) => `<div><dt>${escapeHtml(row.days)}</dt><dd>${escapeHtml(row.hours)}</dd></div>`)
    .join("");
  return `<section aria-labelledby="hours"><h2 id="hours">Часы работы</h2><dl class="hours">${rows}</dl></section>`;
};

const renderContacts = (card: MiniSiteCard): string => {
  const buttons = [`<a class="btn primary" href="${escapeHtml(telLink(card.phone))}"${goalAttr("call")}>Позвонить</a>`];
  if (card.messengers.whatsapp !== undefined) {
    buttons.push(externalLink(whatsappLink(card.messengers.whatsapp), "Написать в WhatsApp", "messenger", "btn"));
  }
  if (card.messengers.telegram !== undefined) {
    buttons.push(externalLink(telegramLink(card.messengers.telegram), "Написать в Telegram", "messenger", "btn"));
  }
  if (card.bookingUrl !== undefined) {
    buttons.push(externalLink(safeUrl(card.bookingUrl, "bookingUrl"), "Записаться онлайн", "booking", "btn"));
  }
  return `<nav class="actions" aria-label="Связаться">${buttons.join("")}</nav>`;
};

const renderAddress = (card: MiniSiteCard): string => {
  const address = escapeHtml(card.address);
  return (
    `<section aria-labelledby="address"><h2 id="address">Как нас найти</h2><address>${address}</address>` +
    `<iframe class="map" src="${escapeHtml(yandexMapEmbedUrl(card.address))}" width="600" height="300" loading="lazy" title="Карта: ${address}" referrerpolicy="no-referrer-when-downgrade"></iframe>` +
    externalLink(yandexRouteUrl(card.address), "Построить маршрут", "route", "btn") +
    `</section>`
  );
};

const metrikaTag = (counterId: number): string =>
  `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();` +
  `for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}` +
  `k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})` +
  `(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");` +
  `ym(${counterId},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true});` +
  `document.addEventListener("click",function(ev){var el=ev.target instanceof Element?ev.target.closest("[data-goal]"):null;` +
  `if(el){ym(${counterId},"reachGoal",el.getAttribute("data-goal"));}});</script>` +
  `<noscript><div><img src="https://mc.yandex.ru/watch/${counterId}" style="position:absolute;left:-9999px" alt=""></div></noscript>`;

const STYLES =
  `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#fff}` +
  `main,footer{max-width:720px;margin:0 auto;padding:16px}h1{font-size:1.75rem;line-height:1.2;margin:8px 0}h2{font-size:1.25rem;margin:24px 0 8px}` +
  `h3{font-size:1rem;margin:0}p{margin:4px 0}.muted{color:#555;font-size:.875rem}` +
  `.actions{display:grid;gap:8px;margin:16px 0}.btn{display:block;padding:14px;border:2px solid #1f6feb;border-radius:12px;color:#1f6feb;text-align:center;font-weight:600;text-decoration:none}` +
  `.btn.primary{background:#1f6feb;color:#fff}.services{list-style:none;padding:0;margin:0}` +
  `.services li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #e5e5e5}.services strong{white-space:nowrap}` +
  `.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.photos img{width:100%;height:auto;border-radius:8px;display:block}` +
  `.hours div{display:flex;justify-content:space-between;padding:4px 0}.hours dt,.hours dd{margin:0}address{font-style:normal;margin-bottom:8px}` +
  `.map{display:block;width:100%;height:300px;border:0;border-radius:8px;margin-bottom:8px}` +
  `footer{color:#555;font-size:.8125rem;border-top:1px solid #e5e5e5}` +
  `@media (min-width:600px){.actions{grid-template-columns:repeat(2,1fr)}}`;

/** Renders a self-contained, mobile-first mini-site page from the business card. */
export const renderMiniSite = (card: MiniSiteCard, options: RenderOptions): RenderedMiniSite => {
  validateOptions(options);
  const name = escapeHtml(requireText(card.businessName, "businessName"));
  requireText(card.address, "address");
  const description = card.description === undefined ? "" : `<p>${escapeHtml(card.description)}</p>`;
  const metaDescription = escapeHtml(card.description ?? `${card.businessName}: услуги, цены, адрес и контакты`);
  const photos =
    card.photos.length === 0
      ? ""
      : `<section aria-labelledby="photos"><h2 id="photos">Фотографии</h2><div class="photos">${card.photos
          .map((photo, index) => renderPhoto(photo, index, card.businessName))
          .join("")}</div></section>`;
  const advertiser = options.advertiser;

  const html =
    `<!doctype html><html lang="ru"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${name}</title><meta name="description" content="${metaDescription}">` +
    `<meta name="referrer" content="strict-origin-when-cross-origin">` +
    `<style>${STYLES}</style></head><body>` +
    `<main><header><h1>${name}</h1>${description}</header>` +
    renderContacts(card) +
    renderServices(card.services) +
    photos +
    renderHours(card) +
    renderAddress(card) +
    `</main><footer><p>Рекламодатель: ${escapeHtml(advertiser.name)}, ИНН ${escapeHtml(advertiser.inn)}</p></footer>` +
    metrikaTag(options.metrikaCounterId) +
    `</body></html>`;

  return { html, assets: {} };
};
