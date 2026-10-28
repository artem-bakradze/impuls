import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { MiniSiteStore } from "@impuls/minisite";

/**
 * Mini-site files on a local directory served by any static web server (local stand and e2e).
 * Production uses S3-compatible storage behind the same port (design decision 16).
 */
export class FileMiniSiteStore implements MiniSiteStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(path: string, body: string): Promise<void> {
    const target = resolve(join(this.root, path));
    if (!target.startsWith(`${this.root}/`)) {
      throw new Error(`Refusing to write outside the mini-site root: ${path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }

  invalidate(): Promise<void> {
    // A plain directory has no CDN cache to purge.
    return Promise.resolve();
  }
}
