import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkPhoto, PHOTO_MAX_BYTES } from "./photos";

/** A real (tiny-content) PNG of the given size, so image parsing is exercised for real. */
export const png = (width: number, height: number): Uint8Array => {
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(0, 9); // grayscale
  const raw = Buffer.alloc((width + 1) * height);
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
};

describe("checkPhoto", () => {
  it("accepts a photo at least 450 px on the shorter side", () => {
    expect(checkPhoto(png(800, 600), 0)).toEqual({ ok: true, width: 800, height: 600, format: "png" });
  });

  it("rejects a photo smaller than 450 px with the plain message", () => {
    expect(checkPhoto(png(800, 300), 0)).toEqual({ ok: false, code: "TOO_SMALL", message: "Фото слишком маленькое — загрузите другое" });
  });

  it("rejects non-images, unsupported formats, oversized files and the 11th photo", () => {
    expect(checkPhoto(new TextEncoder().encode("not an image at all"), 0)).toMatchObject({ ok: false, code: "NOT_IMAGE" });
    const bmp = new Uint8Array([0x42, 0x4d, 0x3a, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0, 0, 0, 0xf4, 1, 0, 0, 0xf4, 1, 0, 0, 1, 0, 0x18, 0, 0, 0, 0, 0]);
    expect(checkPhoto(bmp, 0)).toMatchObject({ ok: false, code: "FORMAT" });
    expect(checkPhoto(new Uint8Array(PHOTO_MAX_BYTES + 1), 0)).toMatchObject({ ok: false, code: "TOO_BIG" });
    expect(checkPhoto(png(800, 600), 10)).toMatchObject({ ok: false, code: "TOO_MANY" });
  });
});
