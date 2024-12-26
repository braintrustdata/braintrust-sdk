import iso from "../isomorph";

export function canUseDiskCache(): boolean {
  return !!(
    iso.gunzip &&
    iso.gzip &&
    iso.stat &&
    iso.readFile &&
    iso.writeFile &&
    iso.utimes &&
    iso.readdir &&
    iso.mkdir &&
    iso.unlink &&
    iso.homedir
  );
}

/**
 * Configuration options for DiskCache.
 */
interface DiskCacheOptions {
  /**
   * Directory where cache files will be stored.
   */
  cacheDir: string;

  /**
   * Maximum number of entries to store in the cache.
   * If not specified, the cache will grow unbounded.
   */
  max?: number;
}

/**
 * A persistent filesystem-based cache implementation.
 *
 * This cache stores entries as compressed files on disk and implements an LRU eviction
 * policy based on file modification times (mtime). While access times (atime) would be more
 * semantically accurate for LRU, we use mtime because:
 *
 * 1. Many modern filesystems mount with noatime for performance reasons.
 * 2. Even when atime updates are enabled, they may be subject to update delays.
 * 3. mtime updates are more reliably supported across different filesystems.
 *
 * @template T - The type of values stored in the cache.
 */
export class DiskCache<T> {
  private readonly dir: string;
  private readonly max?: number;

  /**
   * Creates a new DiskCache instance.
   * @param options - Configuration options for the cache.
   */
  constructor(options: DiskCacheOptions) {
    if (!canUseDiskCache()) {
      throw new Error("Disk cache is not supported on this platform");
    }
    this.dir = options.cacheDir;
    this.max = options.max;
  }

  /**
   * Gets the file path for a cache entry.
   * @param key - The cache key to get the path for.
   * @returns The full filesystem path for the cache entry.
   */
  private getEntryPath(key: string): string {
    return iso.pathJoin!(this.dir, key);
  }

  /**
   * Retrieves a value from the cache.
   * Updates the entry's access time when read.
   *
   * @param key - The key to look up in the cache.
   * @returns The cached value if found, undefined otherwise.
   * @throws If there is an error reading from the disk cache (except for file not found).
   */
  async get(key: string): Promise<T | undefined> {
    try {
      const filePath = this.getEntryPath(key);
      const data = await iso.gunzip!(await iso.readFile!(filePath));
      // Update both access and modification times.
      await iso.utimes!(filePath, new Date(), new Date());
      return JSON.parse(data.toString());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw e;
    }
  }

  /**
   * Stores a value in the cache.
   * If the cache is at its maximum size, the least recently used entries will be evicted.
   *
   * @param key - The key to store the value under.
   * @param value - The value to store in the cache.
   */
  async set(key: string, value: T): Promise<void> {
    await iso.mkdir!(this.dir, { recursive: true });
    const filePath = this.getEntryPath(key);
    const data = await iso.gzip!(JSON.stringify(value));
    await iso.writeFile!(filePath, data);

    if (this.max) {
      const entries = await iso.readdir!(this.dir);
      if (entries.length > this.max) {
        await this.evictOldest(entries);
      }
    }
  }

  /**
   * Evicts the oldest entries from the cache until it is under the maximum size.
   * @param entries - List of all cache entry filenames.
   */
  private async evictOldest(entries: string[]): Promise<void> {
    interface CacheEntry {
      name: string;
      mtime: number;
    }

    const stats = await Promise.all(
      entries.map(async (entry): Promise<CacheEntry> => {
        const stat = await iso.stat!(this.getEntryPath(entry));
        return {
          name: entry,
          mtime: stat.mtime.getTime(),
        };
      }),
    );

    stats.sort((a, b) => a.mtime - b.mtime);
    const toRemove = stats.slice(0, stats.length - this.max!);

    await Promise.all(
      toRemove.map((stat) => iso.unlink!(this.getEntryPath(stat.name))),
    );
  }
}
