import { Prompt } from "../logger";
import { LRUCache } from "./lru-cache";
import { DiskCache } from "./disk-cache";

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
 * Creates a unique cache key from prompt key.
 * @param key - The prompt key to convert into a cache key.
 * @returns A string that uniquely identifies the prompt in the cache.
 * @throws {Error} If neither projectId nor projectName is provided.
 */
function createCacheKey(key: PromptKey): string {
  const prefix = key.projectId || key.projectName;
  if (!prefix) {
    throw new Error("Either projectId or projectName must be provided");
  }
  return `${prefix}:${key.slug}:${key.version}`;
}

/**
 * A two-layer cache for Braintrust prompts with both in-memory and filesystem storage.
 *
 * This cache implements either a one or two-layer caching strategy:
 * 1. A fast in-memory LRU cache for frequently accessed prompts.
 * 2. An optional persistent filesystem-based cache that serves as a backing store.
 */
export class PromptCache {
  private readonly diskCache?: DiskCache<Prompt>;
  private readonly memoryCache: LRUCache<string, Prompt>;

  constructor(options: {
    diskCache?: DiskCache<Prompt>;
    memoryCacheMax?: number;
  }) {
    this.diskCache = options.diskCache;
    this.memoryCache = new LRUCache({ max: options.memoryCacheMax });
  }

  /**
   * Retrieves a prompt from the cache.
   * First checks the in-memory LRU cache, then falls back to checking the disk cache if available.
   */
  async get(key: PromptKey): Promise<Prompt | undefined> {
    const cacheKey = createCacheKey(key);

    // First check memory cache.
    const memoryPrompt = this.memoryCache.get(cacheKey);
    if (memoryPrompt !== undefined) {
      return memoryPrompt;
    }

    // If not in memory and disk cache exists, check disk cache.
    if (this.diskCache) {
      const diskPrompt = await this.diskCache.get(cacheKey);
      if (!diskPrompt) {
        return undefined;
      }
      // Store in memory cache.
      this.memoryCache.set(cacheKey, diskPrompt);
      return diskPrompt;
    }

    return undefined;
  }

  /**
   * Stores a prompt in the cache.
   * Writes to the in-memory cache and the disk cache if available.
   *
   * @param key - The key to store the value under.
   * @param value - The value to store in the cache.
   * @throws If there is an error writing to the disk cache.
   */
  async set(key: PromptKey, value: Prompt): Promise<void> {
    const cacheKey = createCacheKey(key);

    // Update memory cache.
    this.memoryCache.set(cacheKey, value);

    // Update disk cache if available.
    if (this.diskCache) {
      await this.diskCache.set(cacheKey, value);
    }
  }
}
