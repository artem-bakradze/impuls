import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { imageSize } from "image-size";

/** Direct requirements for photos used in network ads (ad-creatives spec). */
export const PHOTO_MIN_SIDE = 450;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_FORMATS = ["jpg", "png", "gif"] as const;
export const MAX_PHOTOS = 10;

export type PhotoCheck =
  | { ok: true; width: number; height: number; format: (typeof PHOTO_FORMATS)[number] }
  | { ok: false; code: "TOO_SMALL" | "TOO_BIG" | "FORMAT" | "NOT_IMAGE" | "TOO_MANY"; message: string };

/** Checks a photo before it is stored or sent to the platform. */
export const checkPhoto = (bytes: Uint8Array, alreadyUploaded: number): PhotoCheck => {
  if (alreadyUploaded >= MAX_PHOTOS) {
    return { ok: false, code: "TOO_MANY", message: `Можно загрузить до ${MAX_PHOTOS} фотографий` };
  }
  if (bytes.byteLength > PHOTO_MAX_BYTES) {
    return { ok: false, code: "TOO_BIG", message: "Фото больше 10 МБ — загрузите файл поменьше" };
  }
  let size: ReturnType<typeof imageSize>;
  try {
    size = imageSize(bytes);
  } catch {
    return { ok: false, code: "NOT_IMAGE", message: "Это не похоже на фотографию — загрузите JPG или PNG" };
  }
  const format = size.type === "jpg" || size.type === "png" || size.type === "gif" ? size.type : null;
  if (format === null) {
    return { ok: false, code: "FORMAT", message: "Подходят только JPG, PNG или GIF" };
  }
  if (Math.min(size.width, size.height) < PHOTO_MIN_SIDE) {
    return { ok: false, code: "TOO_SMALL", message: "Фото слишком маленькое — загрузите другое" };
  }
  return { ok: true, width: size.width, height: size.height, format };
};

export interface PhotoStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", gif: "image/gif" } as const;

/** Photos in S3-compatible storage (design decision 12). */
export class S3PhotoStore {
  private readonly client: S3Client;
  constructor(private readonly config: PhotoStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /** Validates and uploads; returns the public URL or the plain-language reason for refusal. */
  async upload(businessId: string, bytes: Uint8Array, alreadyUploaded: number): Promise<{ ok: true; url: string; width: number; height: number } | Extract<PhotoCheck, { ok: false }>> {
    const check = checkPhoto(bytes, alreadyUploaded);
    if (!check.ok) {
      return check;
    }
    const key = `${businessId}/${randomUUID()}.${check.format}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: CONTENT_TYPES[check.format] }));
    return { ok: true, url: `${this.config.publicBaseUrl}/${key}`, width: check.width, height: check.height };
  }
}
