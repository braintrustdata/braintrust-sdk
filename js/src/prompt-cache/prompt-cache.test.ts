import * as fs from "fs/promises";
import * as path from "path";
import { PromptCache } from "./prompt-cache";
import { Prompt } from "../logger";
import { tmpdir } from "os";
import { beforeEach, describe, it, afterEach, expect } from "vitest";
import type { PromptKey } from "./prompt-cache";
import { DiskCache } from "./disk-cache";
import { configureNode } from "../node";
import { LRUCache } from "./lru-cache";

describe("PromptCache", () => {
  configureNode();

  let cacheDir: string;
  let cache: PromptCache;

  const testPrompt = new Prompt(
    {
      project_id: "123",
      name: "test-prompt",
      slug: "test-prompt",
      id: "456",
      _xact_id: "789",
    },
    {},
    false,
  );

  const testKey = {
    projectId: "123",
    slug: "test-prompt",
    version: "789",
  };

  const testKeyWithName = {
    projectName: "test-project",
    slug: "test-prompt",
    version: "789",
  };

  beforeEach(async () => {
    // Create a unique temporary directory for each test.
    cacheDir = path.join(tmpdir(), `prompt-cache-test-${Date.now()}`);
    cache = new PromptCache({
      memoryCache: new LRUCache<string, Prompt>({ max: 2 }),
      diskCache: new DiskCache<Prompt>({
        cacheDir,
        max: 5,
      }),
    });
  });

  afterEach(async () => {
    // Clean up the temporary directory.
    try {
      await fs.rm(cacheDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors if directory doesn't exist.
    }
  });

  describe("get and set", () => {
    it("should store and retrieve a prompt from memory cache", async () => {
      await cache.set(testKey, testPrompt);
      const result = await cache.get(testKey);
      expect(result).toEqual(testPrompt);
    });

    it("should work with project name instead of id", async () => {
      await cache.set(testKeyWithName, testPrompt);
      const result = await cache.get(testKeyWithName);
      expect(result).toEqual(testPrompt);
    });

    it("should store and retrieve a prompt from disk cache after memory eviction", async () => {
      // Fill memory cache (max size is 2).
      await cache.set(testKey, testPrompt);
      await cache.set({ ...testKey, slug: "prompt2" }, testPrompt);
      await cache.set({ ...testKey, slug: "prompt3" }, testPrompt);

      // Original prompt should now be on disk but not in memory.
      const result = await cache.get(testKey);
      expect(result).toEqual(testPrompt);
    });

    it("should return undefined for non-existent prompts", async () => {
      const result = await cache.get({
        ...testKey,
        slug: "missing-prompt",
        version: "789",
      });
      expect(result).toBeUndefined();
    });

    it("should handle different projects with same slug", async () => {
      await cache.set(testKey, testPrompt);
      const differentProject = {
        ...testKey,
        projectId: "different-project",
        version: "789",
      };
      await cache.set(
        differentProject,
        new Prompt(
          {
            project_id: "different-project",
            name: "test-prompt",
            slug: testKey.slug,
            id: "abc",
            _xact_id: "789",
          },
          {},
          false,
        ),
      );

      const result1 = await cache.get(testKey);
      const result2 = await cache.get(differentProject);

      expect(result1?.projectId).toBe(testKey.projectId);
      expect(result2?.projectId).toBe("different-project");
    });

    it("should throw error if neither projectId nor projectName is provided", async () => {
      const invalidKey: PromptKey = { slug: "test-prompt", version: "789" };
      await expect(cache.get(invalidKey)).rejects.toThrow(
        "Either projectId or projectName must be provided",
      );
    });

    it("should handle different versions of the same prompt", async () => {
      const promptV1 = new Prompt(
        {
          project_id: testKey.projectId,
          name: "test-prompt",
          slug: testKey.slug,
          id: "456",
          _xact_id: "789",
        },
        {},
        false,
      );

      const promptV2 = new Prompt(
        {
          project_id: testKey.projectId,
          name: "test-prompt",
          slug: testKey.slug,
          id: "457",
          _xact_id: "790",
        },
        {},
        false,
      );

      // Store both versions.
      await cache.set({ ...testKey, version: "789" }, promptV1);
      await cache.set({ ...testKey, version: "790" }, promptV2);

      // Retrieve and verify both versions.
      const resultV1 = await cache.get({ ...testKey, version: "789" });
      const resultV2 = await cache.get({ ...testKey, version: "790" });

      expect(resultV1?.version).toEqual("789");
      expect(resultV2?.version).toEqual("790");
    });
  });

  describe("disk cache eviction", () => {
    it("should evict oldest entries when disk cache is full", async () => {
      // Fill disk cache beyond max size (5).
      for (let i = 0; i < 5; i++) {
        await cache.set({ ...testKey, slug: `prompt${i}` }, testPrompt);
        // Wait a moment to ensure different mtimes.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Add one more to trigger eviction.
      await cache.set({ ...testKey, slug: "prompt-final" }, testPrompt);

      // The oldest prompt should have been evicted.
      const result = await cache.get({
        ...testKey,
        slug: "prompt0",
      });
      expect(result).toBeUndefined();

      // Newer prompts should still exist.
      const newerResult = await cache.get({
        ...testKey,
        slug: "prompt4",
      });
      expect(newerResult).toEqual(testPrompt);
    });
  });

  describe("error handling", () => {
    it("should throw when disk write fails", async () => {
      // Make cache directory read-only.
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.chmod(cacheDir, 0o444);

      // Should throw when disk write fails.
      await expect(cache.set(testKey, testPrompt)).rejects.toThrow();

      // Memory cache should still be updated.
      const result = await cache.get(testKey);
      expect(result).toEqual(testPrompt);

      // Restore permissions so cleanup can happen.
      await fs.chmod(cacheDir, 0o777);
    });

    it("should handle disk read errors", async () => {
      await cache.set(testKey, testPrompt);

      // Create a new cache instance with empty memory cache.
      const newCache = new PromptCache({
        memoryCache: new LRUCache({ max: 2 }),
        diskCache: new DiskCache<Prompt>({
          cacheDir,
          max: 5,
        }),
      });

      // Corrupt the cache directory.
      await fs.rm(cacheDir, { recursive: true, force: true });

      // Should return undefined when disk read fails.
      const result = await newCache.get(testKey);
      expect(result).toBeUndefined();
    });
  });

  describe("memory cache behavior", () => {
    it("should evict items from memory while preserving them on disk", async () => {
      // Fill memory cache (max size is 2).
      await cache.set(testKey, testPrompt);
      await cache.set({ ...testKey, slug: "prompt2" }, testPrompt);

      // This should evict the first prompt from memory but keep it on disk.
      await cache.set({ ...testKey, slug: "prompt3" }, testPrompt);

      // Should still be able to get the first prompt from disk.
      const result = await cache.get(testKey);
      expect(result).toEqual(testPrompt);
    });

    it("should update memory cache after disk cache hit", async () => {
      await cache.set(testKey, testPrompt);

      // Create a new cache instance (empty memory cache).
      const newCache = new PromptCache({
        memoryCache: new LRUCache({ max: 2 }),
        diskCache: new DiskCache<Prompt>({
          cacheDir,
          max: 5,
        }),
      });

      // First get should load from disk into memory.
      await newCache.get(testKey);

      // Corrupt the disk cache.
      await fs.rm(cacheDir, { recursive: true, force: true });

      // Second get should still work (from memory).
      const result = await newCache.get(testKey);
      expect(result).toEqual(testPrompt);
    });
  });

  describe("memory-only cache", () => {
    let memoryOnlyCache: PromptCache;

    beforeEach(() => {
      memoryOnlyCache = new PromptCache({
        memoryCache: new LRUCache({ max: 2 }),
      });
    });

    it("should store and retrieve values from memory", async () => {
      await memoryOnlyCache.set(testKey, testPrompt);
      const result = await memoryOnlyCache.get(testKey);
      expect(result).toEqual(testPrompt);
    });

    it("should respect memory cache size limits", async () => {
      // Fill memory cache (max size is 2).
      await memoryOnlyCache.set(testKey, testPrompt);
      await memoryOnlyCache.set({ ...testKey, slug: "prompt2" }, testPrompt);

      // This should evict the first prompt.
      await memoryOnlyCache.set({ ...testKey, slug: "prompt3" }, testPrompt);

      // First prompt should be gone since there's no disk backup.
      const result = await memoryOnlyCache.get(testKey);
      expect(result).toBeUndefined();

      // Newer prompts should exist.
      const newerResult = await memoryOnlyCache.get({
        ...testKey,
        slug: "prompt3",
      });
      expect(newerResult).toEqual(testPrompt);
    });
  });
});
