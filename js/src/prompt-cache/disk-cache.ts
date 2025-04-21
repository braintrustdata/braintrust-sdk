import iso from "../isomorph";
import crypto from "crypto";

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

  private getEntryPath(key: string): string {
    const hashed = crypto.createHash("sha256").update(key).digest("hex");
    return iso.pathJoin!(this.dir, hashed);
  }

  /**
   * Retrieves a value from the cache.
   * Updates the entry's access time when read.
   *
   * @param key - The key to look up in the cache.
   * @returns The cached value if found, undefined otherwise.
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
      // FIXME[matt] log any unexpected exceptions (file systems, etc)
      return undefined;
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

    try {
      await iso.writeFile!(filePath, data);
      await this.evictOldestIfFull();
    } catch (e) {
      // FIXME[matt] log any unexpected exceptions (file systems, etc)
      return;
    }
  }

  private async evictOldestIfFull(): Promise<void> {
    if (!this.max) {
      return;
    }

    const files = await iso.readdir!(this.dir);
    const paths = files.map((file) => iso.pathJoin!(this.dir, file));

    if (paths.length <= this.max) {
      return;
    }

    interface CacheEntry {
      name: string;
      mtime: number;
    }

    const stats = await Promise.all(
      paths.map(async (path): Promise<CacheEntry> => {
        const stat = await iso.stat!(path);
        return {
          name: path,
          mtime: stat.mtime.getTime(),
        };
      }),
    );

    stats.sort((a, b) => a.mtime - b.mtime);
    const toRemove = stats.slice(0, stats.length - this.max!);

    await Promise.all(toRemove.map((stat) => iso.unlink!(stat.name)));
  }
}
