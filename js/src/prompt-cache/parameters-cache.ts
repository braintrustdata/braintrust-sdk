import { Parameters } from "../logger";
import { LRUCache } from "./lru-cache";
import { DiskCache } from "./disk-cache";

export interface ParametersKey {
  slug?: string;
  version?: string;
  projectId?: string;
  projectName?: string;
  id?: string;
}

function createCacheKey(key: ParametersKey): string {
  if (key.id) {
    return `parameters:id:${key.id}`;
  }

  const prefix = key.projectId ?? key.projectName;
  if (!prefix) {
    throw new Error("Either projectId or projectName must be provided");
  }
  if (!key.slug) {
    throw new Error("Slug must be provided when not using ID");
  }
  return `parameters:${prefix}:${key.slug}:${key.version ?? "latest"}`;
}

export class ParametersCache {
  private readonly memoryCache: LRUCache<string, Parameters>;
  private readonly diskCache?: DiskCache<Parameters>;

  constructor(options: {
    memoryCache: LRUCache<string, Parameters>;
    diskCache?: DiskCache<Parameters>;
  }) {
    this.memoryCache = options.memoryCache;
    this.diskCache = options.diskCache;
  }

  async get(key: ParametersKey): Promise<Parameters | undefined> {
    const cacheKey = createCacheKey(key);

    const memoryParams = this.memoryCache.get(cacheKey);
    if (memoryParams !== undefined) {
      return memoryParams;
    }

    if (this.diskCache) {
      const diskParams = await this.diskCache.get(cacheKey);
      if (!diskParams) {
        return undefined;
      }
      this.memoryCache.set(cacheKey, diskParams);
      return diskParams;
    }

    return undefined;
  }

  async set(key: ParametersKey, value: Parameters): Promise<void> {
    const cacheKey = createCacheKey(key);

    this.memoryCache.set(cacheKey, value);

    if (this.diskCache) {
      await this.diskCache.set(cacheKey, value);
    }
  }
}
