import * as fs from "fs/promises";
import * as path from "path";
import { Prompt } from "./logger";
import { LRUCache } from "./lru-cache";
import * as zlib from "zlib";
import { promisify } from "util";

// Promisified zlib functions.
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Represents an entry in the filesystem cache.
 */
interface CacheEntry {
  /**
   * The name/identifier of the cached prompt.
   * It is the slug of the prompt, and the filename on disk.
   */
  name: string;

  /**
   * The last modification time of the cache entry, used for LRU eviction.
   * This is stored as a Unix timestamp in milliseconds.
   */
  mtime: number;
}

/**
 * A two-layer cache for Braintrust prompts with both in-memory and filesystem storage.
 *
 * This cache implements a two-layer caching strategy:
 * 1. A fast in-memory LRU cache for frequently accessed prompts
 * 2. A persistent filesystem-based cache that serves as a backing store
 *
 * When retrieving a prompt, the cache first checks the in-memory store. On a miss,
 * it falls back to the filesystem cache and populates the memory cache with the result.
 * When storing a prompt, it is written to both caches simultaneously.
 *
 * The filesystem cache manages entries using an LRU (Least Recently Used) eviction policy
 * based on file modification times (mtime). While access times (atime) would be more
 * semantically accurate for LRU, we use mtime because:
 *
 * 1. Many modern filesystems mount with noatime for performance reasons, which disables
 *    atime updates entirely
 * 2. Even when atime updates are enabled, they may be subject to update delays or
 *    restrictions (e.g. relatime mount option)
 * 3. mtime updates are more reliably supported across different filesystems and OS configurations
 *
 * Both caches automatically evict old entries when they exceed their configured maximum sizes.
 *
 * @example
 * ```typescript
 * const cache = new PromptCache({
 *   cacheDir: "/path/to/cache",
 *   max: 1000,           // Maximum number of files in disk cache
 *   memoryCacheMax: 100  // Maximum number of entries in memory cache
 * });
 *
 * // Store a prompt
 * await cache.set("my-prompt", promptObject);
 *
 * // Retrieve a prompt (checks memory first, then disk)
 * const prompt = await cache.get("my-prompt");
 * ```
 */

/**
 * Identifies a prompt in the cache using either project ID or project name along with the slug.
 */
export interface PromptKey {
  /**
   * The slug identifier for the prompt within its project.
   */
  slug: string;

  /**
   * The version of the prompt.
   */
  version: string;

  /**
   * The ID of the project containing the prompt.
   * Either projectId or projectName must be provided.
   */
  projectId?: string;

  /**
   * The name of the project containing the prompt.
   * Either projectId or projectName must be provided.
   */
  projectName?: string;
}

/**
 * Creates a unique cache key from prompt key
 */
function createCacheKey(key: PromptKey): string {
  const prefix = key.projectId || key.projectName;
  if (!prefix) {
    throw new Error("Either projectId or projectName must be provided");
  }
  return `${prefix}:${key.slug}:${key.version}`;
}

export class PromptCache {
  private readonly dir: string;
  private readonly max?: number;
  private readonly memoryCache: LRUCache<string, Prompt>;

  constructor(options: {
    cacheDir: string;
    max?: number;
    memoryCacheMax?: number;
  }) {
    this.dir = options.cacheDir;
    this.max = options.max;
    this.memoryCache = new LRUCache({ max: options.memoryCacheMax });
  }

  /**
   * Gets the file path for the disk cache entry for a given entry name.
   */
  private getEntryPath(name: string): string {
    return path.join(this.dir, name);
  }

  /**
   * Retrieves a prompt from the cache.
   * First checks the in-memory LRU cache, then falls back to checking the disk cache if not found.
   * Updates access and modification times when reading from disk cache.
   *
   * @param key - Object containing slug and either projectId or projectName
   * @returns The cached Prompt object if found, undefined otherwise
   * @throws If there is an error reading from the disk cache (except for file not found)
   */
  async get(key: PromptKey): Promise<Prompt | undefined> {
    const cacheKey = createCacheKey(key);

    // First check memory cache.
    const prompt = this.memoryCache.get(cacheKey);
    if (prompt !== undefined) {
      return prompt;
    }

    // If not in memory, check disk cache.
    try {
      const filePath = this.getEntryPath(cacheKey);
      const data = await gunzip(await fs.readFile(filePath));
      // Update both access and modification times.
      await fs.utimes(filePath, new Date(), new Date());
      const prompt = JSON.parse(data.toString());

      // Store in memory cache.
      this.memoryCache.set(cacheKey, prompt);

      return prompt;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Stores a prompt in the cache.
   * Writes to both the in-memory cache and the disk cache.
   *
   * @param key - Object containing slug and either projectId or projectName
   * @param value - The Prompt object to store
   * @throws If there is an error writing to the disk cache
   */
  async set(key: PromptKey, value: Prompt): Promise<void> {
    const cacheKey = createCacheKey(key);

    // Update memory cache.
    this.memoryCache.set(cacheKey, value);

    try {
      // Update disk cache.
      await fs.mkdir(this.dir, { recursive: true });
      const filePath = this.getEntryPath(cacheKey);
      const data = await gzip(JSON.stringify(value));
      await fs.writeFile(filePath, data);

      if (this.max) {
        const entries = await fs.readdir(this.dir);
        if (entries.length > this.max) {
          await this.evictOldest(entries);
        }
      }
    } catch (e) {
      console.warn(`Failed to write to prompt cache: ${e}`);
    }
  }

  /**
   * Evicts the oldest entries from the cache until it is under the maximum size.
   * @precondition this.max is not undefined
   */
  private async evictOldest(entries: string[]): Promise<void> {
    const stats = await Promise.all(
      entries.map(async (entry): Promise<CacheEntry> => {
        const stat = await fs.stat(this.getEntryPath(entry));
        return {
          name: entry,
          mtime: stat.mtime.getTime(),
        };
      }),
    );

    stats.sort((a, b) => a.mtime - b.mtime);
    const toRemove = stats.slice(0, stats.length - this.max!);

    await Promise.all(
      toRemove.map((stat) => fs.unlink(this.getEntryPath(stat.name))),
    );
  }
}
