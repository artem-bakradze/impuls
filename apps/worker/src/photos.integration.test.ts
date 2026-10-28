import { CreateBucketCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { S3PhotoStore } from "./photos";
import { png } from "./photos.test";

// Requires an S3-compatible server: docker run -d --rm --name impuls-s3 -p 9000:9090 adobe/s3mock
const endpoint = process.env.S3_TEST_ENDPOINT ?? "";
if (endpoint === "") {
  throw new Error("S3_TEST_ENDPOINT is required for photo storage integration tests");
}
const config = { endpoint, region: "ru-central1", bucket: "impuls-photos", accessKeyId: "test", secretAccessKey: "test", publicBaseUrl: `${endpoint}/impuls-photos` };
const client = new S3Client({ endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } });

beforeAll(async () => {
  await client.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((error: unknown) => {
    if (!(error instanceof Error && /BucketAlready/.test(error.name))) {
      throw error;
    }
  });
});

describe("S3PhotoStore", () => {
  it("uploads a suitable photo and returns its public URL", async () => {
    const result = await new S3PhotoStore(config).upload("b1", png(900, 600), 0);
    expect(result).toMatchObject({ ok: true, width: 900, height: 600 });
    const key = result.ok ? result.url.replace(`${config.publicBaseUrl}/`, "") : "";
    const stored = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    expect(stored.ContentType).toBe("image/png");
  });

  it("does not upload a photo that is too small", async () => {
    expect(await new S3PhotoStore(config).upload("b1", png(300, 300), 0)).toMatchObject({ ok: false, message: "Фото слишком маленькое — загрузите другое" });
  });
});
