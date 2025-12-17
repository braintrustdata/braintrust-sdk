/**
 * SpanCache provides a disk-based cache for span data, allowing
 * scorers to read spans without making server round-trips when possible.
 *
 * Spans are stored on disk to minimize memory usage during evaluations.
 * The cache file is automatically cleaned up when dispose() is called.
 *
 * In browser environments where filesystem access isn't available,
 * the cache becomes a no-op (all lookups return undefined).
 */

import iso from "./isomorph";

/**
 * Check if the span cache can be used (requires filesystem APIs).
 * This is called at runtime, not at module load time, to allow
 * configureNode() to set up the isomorph functions first.
 */
function canUseSpanCache(): boolean {
  return !!(
    iso.pathJoin &&
    iso.tmpdir &&
    iso.writeFileSync &&
    iso.appendFileSync &&
    iso.readFileSync &&
    iso.unlinkSync &&
    iso.openFile
  );
}

export interface CachedSpan {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  span_id: string;
  span_parents?: string[];
  span_attributes?: {
    name?: string;
    type?: string;
    [key: string]: unknown;
  };
}

interface DiskSpanRecord {
  rootSpanId: string;
  spanId: string;
  data: CachedSpan;
}

/**
 * Disk-based cache for span data, keyed by rootSpanId.
 *
 * This cache writes spans to a temporary file to minimize memory usage.
 * It uses append-only writes and reads the full file when querying.
 *
 * In browser environments, this cache is automatically disabled and
 * all operations become no-ops.
 */
export class SpanCache {
  private cacheFilePath: string | null = null;
  private fileHandle: any | null = null; // type-erased fs.promises.FileHandle
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private _explicitlyDisabled: boolean;

  // Small in-memory index tracking which rootSpanIds have data
  private rootSpanIndex: Set<string> = new Set();

  constructor(options?: { disabled?: boolean }) {
    // Only track explicit disable from constructor - platform check is done at runtime
    this._explicitlyDisabled = options?.disabled ?? false;
    // Initialization is lazy - file is created on first write
  }

  /**
   * Disable the cache at runtime. This is called automatically when
   * initFunction is used, since remote function spans won't be in the cache.
   */
  disable(): void {
    this._explicitlyDisabled = true;
  }

  get disabled(): boolean {
    return this._explicitlyDisabled || !canUseSpanCache();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.disabled) {
      return;
    }

    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const tmpDir = iso.tmpdir!();
      const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.cacheFilePath = iso.pathJoin!(
        tmpDir,
        `braintrust-span-cache-${uniqueId}.jsonl`,
      );

      // Open file for append+read
      this.fileHandle = await iso.openFile!(this.cacheFilePath, "a+");
      this.initialized = true;
    })();

    return this.initPromise;
  }

  /**
   * Write or update a span in the cache.
   *
   * @param rootSpanId The root span ID that groups this span
   * @param spanId The unique ID of this span
   * @param data The span data to cache
   */
  async write(
    rootSpanId: string,
    spanId: string,
    data: CachedSpan,
  ): Promise<void> {
    if (this.disabled) {
      return;
    }

    await this.ensureInitialized();

    const record: DiskSpanRecord = { rootSpanId, spanId, data };
    const line = JSON.stringify(record) + "\n";

    await this.fileHandle!.appendFile(line, "utf8");
    this.rootSpanIndex.add(rootSpanId);
  }

  /**
   * Synchronous write - fire and forget.
   * Uses sync file operations to avoid blocking the caller.
   */
  writeSync(rootSpanId: string, spanId: string, data: CachedSpan): void {
    if (this.disabled) {
      return;
    }

    // Lazy init - create file synchronously if needed
    if (!this.initialized) {
      const tmpDir = iso.tmpdir!();
      const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.cacheFilePath = iso.pathJoin!(
        tmpDir,
        `braintrust-span-cache-${uniqueId}.jsonl`,
      );
      // Touch the file
      iso.writeFileSync!(this.cacheFilePath, "");
      this.initialized = true;
    }

    const record: DiskSpanRecord = { rootSpanId, spanId, data };
    const line = JSON.stringify(record) + "\n";

    iso.appendFileSync!(this.cacheFilePath!, line);
    this.rootSpanIndex.add(rootSpanId);
  }

  /**
   * Get all cached spans for a given rootSpanId.
   *
   * This reads the file and merges all records for the given rootSpanId.
   *
   * @param rootSpanId The root span ID to look up
   * @returns Array of cached spans, or undefined if not in cache
   */
  getByRootSpanId(rootSpanId: string): CachedSpan[] | undefined {
    if (this.disabled) {
      return undefined;
    }

    if (!this.initialized || !this.cacheFilePath) {
      return undefined;
    }

    // Quick check using in-memory index
    if (!this.rootSpanIndex.has(rootSpanId)) {
      return undefined;
    }

    try {
      const content = iso.readFileSync!(this.cacheFilePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Accumulate spans by spanId, merging updates
      const spanMap = new Map<string, CachedSpan>();

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as DiskSpanRecord;
          if (record.rootSpanId !== rootSpanId) {
            continue;
          }

          const existing = spanMap.get(record.spanId);
          if (existing) {
            spanMap.set(
              record.spanId,
              this.mergeSpanData(existing, record.data),
            );
          } else {
            spanMap.set(record.spanId, record.data);
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (spanMap.size === 0) {
        return undefined;
      }

      return Array.from(spanMap.values());
    } catch {
      return undefined;
    }
  }

  /**
   * Check if a rootSpanId has cached data.
   */
  has(rootSpanId: string): boolean {
    if (this.disabled) {
      return false;
    }
    return this.rootSpanIndex.has(rootSpanId);
  }

  /**
   * Clear all cached spans for a given rootSpanId.
   * Note: This only removes from the index. The data remains in the file
   * but will be ignored on reads.
   */
  clear(rootSpanId: string): void {
    this.rootSpanIndex.delete(rootSpanId);
  }

  /**
   * Clear all cached data and remove the cache file.
   */
  clearAll(): void {
    this.rootSpanIndex.clear();
    this.dispose();
  }

  /**
   * Get the number of root spans currently tracked.
   */
  get size(): number {
    return this.rootSpanIndex.size;
  }

  /**
   * Clean up the cache file. Call this when the eval is complete.
   */
  dispose(): void {
    if (this.fileHandle) {
      this.fileHandle.close().catch(() => {});
      this.fileHandle = null;
    }

    if (this.cacheFilePath && canUseSpanCache()) {
      try {
        iso.unlinkSync!(this.cacheFilePath);
      } catch {
        // Ignore cleanup errors
      }
      this.cacheFilePath = null;
    }

    this.initialized = false;
    this.initPromise = null;
    this.rootSpanIndex.clear();
  }

  private mergeSpanData(
    existing: CachedSpan,
    incoming: CachedSpan,
  ): CachedSpan {
    // Merge strategy: incoming values override existing ONLY if defined.
    // Undefined values in incoming should not overwrite existing values.
    return {
      span_id: incoming.span_id,
      span_parents: incoming.span_parents ?? existing.span_parents,
      input: incoming.input !== undefined ? incoming.input : existing.input,
      output: incoming.output !== undefined ? incoming.output : existing.output,
      metadata:
        existing.metadata || incoming.metadata
          ? { ...existing.metadata, ...incoming.metadata }
          : undefined,
      span_attributes:
        existing.span_attributes || incoming.span_attributes
          ? { ...existing.span_attributes, ...incoming.span_attributes }
          : undefined,
    };
  }
}
