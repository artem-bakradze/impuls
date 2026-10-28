export type MiniSiteErrorCode =
  | "INVALID_SLUG"
  | "INVALID_ASSET_PATH"
  | "UNSUPPORTED_ASSET_TYPE"
  | "INVALID_URL"
  | "INVALID_PHONE"
  | "INVALID_TELEGRAM_USERNAME"
  | "INVALID_COUNTER_ID"
  | "INVALID_ADVERTISER"
  | "INVALID_CARD";

/** Validation error raised before a mini-site is rendered or published. Message is internal (English). */
export class MiniSiteValidationError extends Error {
  readonly code: MiniSiteErrorCode;

  constructor(code: MiniSiteErrorCode, message: string) {
    super(message);
    this.name = "MiniSiteValidationError";
    this.code = code;
  }
}
