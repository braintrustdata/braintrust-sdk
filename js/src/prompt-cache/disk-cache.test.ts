import * as fs from "fs/promises";
import * as path from "path";
import { DiskCache } from "./disk-cache";
import { tmpdir } from "os";
import { beforeEach, describe, it, afterEach, expect } from "vitest";
import { configureNode } from "../node";
import iso from "../isomorph";

describe("DiskCache", () => {
  configureNode();

  let cacheDir: string;
  let cache: DiskCache<any>;

  beforeEach(async () => {
    cacheDir = path.join(tmpdir(), `disk-cache-test-${Date.now()}`);
    cache = new DiskCache({ cacheDir, max: 3 });
  });

  afterEach(async () => {
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors if directory doesn't exist.
    }
  });

  it("should store and retrieve values", async () => {
    const testData = { foo: "bar" };
    await cache.set("test-key", testData);
    const result = await cache.get("test-key");
    expect(result).toEqual(testData);
  });

  it("should return undefined for missing keys", async () => {
    const result = await cache.get("missing-key");
    expect(result).toBeUndefined();
  });

  it("should evict oldest entries when cache is full", async () => {
    // Fill cache beyond max size (3).
    for (let i = 0; i < 3; i++) {
      await cache.set(`key${i}`, { value: i });
      // Wait to ensure different mtimes.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Add one more to trigger eviction.
    await cache.set("key3", { value: 3 });

    // The oldest entry should be evicted.
    const result = await cache.get("key0");
    expect(result).toBeUndefined();

    // Newer entries should still exist.
    const newer = await cache.get("key2");
    expect(newer).toEqual({ value: 2 });
  });

  it("should throw when write fails", async () => {
    // Make cache directory read-only.
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.chmod(cacheDir, 0o444);

    // Should throw when write fails.
    await expect(cache.set("test", { foo: "bar" })).rejects.toThrow();
  });

  it("should throw on corrupted data", async () => {
    await cache.set("test-key", { foo: "bar" });

    // Corrupt the file.
    const filePath = path.join(cacheDir, "test-key");
    await fs.writeFile(filePath, "invalid data");

    // Should throw on corrupted data.
    await expect(cache.get("test-key")).rejects.toThrow();
  });

  it("should throw when eviction stat fails", async () => {
    // Fill cache.
    for (let i = 0; i < 3; i++) {
      await cache.set(`key${i}`, { value: i });
    }

    // Fake stat to fail for one file.
    const origStat = iso.stat;
    iso.stat = async (path: string) => {
      if (path.endsWith("key0")) {
        throw new Error("stat error");
      }
      return origStat!(path);
    };

    // Should throw when trying to get stats during eviction.
    await expect(cache.set("key3", { value: 3 })).rejects.toThrow("stat error");

    iso.stat = origStat;
  });

  it("should throw when eviction unlink fails", async () => {
    // Fill cache.
    for (let i = 0; i < 3; i++) {
      await cache.set(`key${i}`, { value: i });
      await new Promise((resolve) => setTimeout(resolve, 100)); // Ensure different mtimes
    }

    // Fake unlink to fail.
    const origUnlink = iso.unlink;
    iso.unlink = async () => {
      throw new Error("unlink error");
    };

    // Should throw when trying to remove files during eviction.
    await expect(cache.set("key3", { value: 3 })).rejects.toThrow(
      "unlink error",
    );

    iso.unlink = origUnlink;
  });
});
