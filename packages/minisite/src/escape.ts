import { MiniSiteValidationError } from "./errors";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for use in HTML element content and quoted attribute values. */
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/** Accepts only absolute http(s) URLs; rejects `javascript:`, `data:` and relative URLs. */
export const safeUrl = (value: string, field: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MiniSiteValidationError("INVALID_URL", `${field} is not a valid absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new MiniSiteValidationError("INVALID_URL", `${field} must use http or https`);
  }
  return parsed.href;
};
