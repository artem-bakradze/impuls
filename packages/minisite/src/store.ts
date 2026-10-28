import type { RenderedMiniSite } from "./card";
import { MiniSiteValidationError } from "./errors";

/** Port to S3-compatible static storage serving the mini-site domain. */
export interface MiniSiteStore {
  put(path: string, body: string, contentType: string): Promise<void>;
  /** Drops cached copies (CDN) of the given paths. */
  invalidate(paths: string[]): Promise<void>;
}

export interface StoredObject {
  body: string;
  contentType: string;
}

export class InMemoryMiniSiteStore implements MiniSiteStore {
  readonly objects = new Map<string, StoredObject>();
  readonly invalidations: string[][] = [];

  put(path: string, body: string, contentType: string): Promise<void> {
    this.objects.set(path, { body, contentType });
    return Promise.resolve();
  }

  invalidate(paths: string[]): Promise<void> {
    this.invalidations.push([...paths]);
    return Promise.resolve();
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 63;

/** Slug becomes a DNS label / path segment: lowercase latin letters, digits and single inner hyphens. */
export const validateSlug = (slug: string): string => {
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH || !SLUG.test(slug)) {
    throw new MiniSiteValidationError(
      "INVALID_SLUG",
      `Invalid mini-site slug "${slug}": use 1-${MAX_SLUG_LENGTH} lowercase latin letters, digits and hyphens, not starting or ending with a hyphen`,
    );
  }
  return slug;
};

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

const CONTENT_TYPES: Record<string, string> = {
  html: HTML_CONTENT_TYPE,
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json",
};

const ASSET_PATH = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]+$/;

export const assetContentType = (path: string): string => {
  if (!ASSET_PATH.test(path) || path === "index.html") {
    throw new MiniSiteValidationError("INVALID_ASSET_PATH", `Invalid mini-site asset path "${path}"`);
  }
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    throw new MiniSiteValidationError("UNSUPPORTED_ASSET_TYPE", `Unsupported mini-site asset type ".${extension}"`);
  }
  return contentType;
};

/** Uploads the rendered page and its assets under `<slug>/` and invalidates the CDN cache. Returns written paths. */
export const publishMiniSite = async (
  store: MiniSiteStore,
  slug: string,
  rendered: RenderedMiniSite,
): Promise<string[]> => {
  validateSlug(slug);
  const files: Array<{ path: string; body: string; contentType: string }> = Object.entries(rendered.assets).map(
    ([path, body]) => ({ path: `${slug}/${path}`, body, contentType: assetContentType(path) }),
  );
  // Page goes last so it never references assets that are not uploaded yet.
  files.push({ path: `${slug}/index.html`, body: rendered.html, contentType: HTML_CONTENT_TYPE });

  for (const file of files) {
    await store.put(file.path, file.body, file.contentType);
  }
  const paths = files.map((file) => file.path);
  await store.invalidate([`${slug}/`, ...paths]);
  return paths;
};
