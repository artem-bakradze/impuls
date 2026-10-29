import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** OAuth tokens are stored encrypted (AGENTS.md: Data & Privacy). Format: `v1.<iv>.<tag>.<ciphertext>`, base64url. */
const VERSION = "v1";
const IV_BYTES = 12;

/** `TOKEN_ENCRYPTION_KEY` is base64 of 32 random bytes (AES-256-GCM); anything else is a configuration error. */
export const parseTokenKey = (base64: string): Buffer => {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  return key;
};

export const encryptToken = (key: Buffer, token: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
};

export const decryptToken = (key: Buffer, stored: string): string => {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Stored token has an unknown format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
};
