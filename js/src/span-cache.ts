/**
 * SpanCache provides a local in-memory cache for span data, allowing
 * scorers to read spans without making server round-trips when possible.
 *
 * Spans are indexed by rootSpanId, matching the query pattern used by
 * Trace.getSpans().
 */

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

export interface SpanCacheOptions {
  /**
   * Maximum number of root spans to cache. When exceeded, oldest entries
   * are evicted. Defaults to 1000.
   */
  maxRootSpans?: number;

  /**
   * Time-to-live in milliseconds. Cached spans older than this are
   * considered stale. Defaults to 300000 (5 minutes).
   */
  ttlMs?: number;
}

interface CacheEntry {
  spans: Map<string, CachedSpan>;
  createdAt: number;
}

const DEFAULT_MAX_ROOT_SPANS = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Local cache for span data, keyed by rootSpanId.
 *
 * This cache is used by Trace.getSpans() to avoid server round-trips
 * when fetching span data that was just logged locally.
 */
export class SpanCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxRootSpans: number;
  private readonly ttlMs: number;

  constructor(options?: SpanCacheOptions) {
    this.maxRootSpans = options?.maxRootSpans ?? DEFAULT_MAX_ROOT_SPANS;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Write or update a span in the cache.
   *
   * @param rootSpanId The root span ID that groups this span
   * @param spanId The unique ID of this span
   * @param data The span data to cache
   */
  write(rootSpanId: string, spanId: string, data: CachedSpan): void {
    let entry = this.cache.get(rootSpanId);

    if (!entry) {
      // Evict oldest entries if at capacity
      this.evictIfNeeded();

      entry = {
        spans: new Map(),
        createdAt: Date.now(),
      };
      this.cache.set(rootSpanId, entry);
    }

    // Merge with existing span data if present
    const existing = entry.spans.get(spanId);
    if (existing) {
      entry.spans.set(spanId, this.mergeSpanData(existing, data));
    } else {
      entry.spans.set(spanId, data);
    }
  }

  /**
   * Get all cached spans for a given rootSpanId.
   *
   * @param rootSpanId The root span ID to look up
   * @returns Array of cached spans, or undefined if not in cache or expired
   */
  getByRootSpanId(rootSpanId: string): CachedSpan[] | undefined {
    const entry = this.cache.get(rootSpanId);

    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(rootSpanId);
      return undefined;
    }

    return Array.from(entry.spans.values());
  }

  /**
   * Check if a rootSpanId has cached data.
   */
  has(rootSpanId: string): boolean {
    const entry = this.cache.get(rootSpanId);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(rootSpanId);
      return false;
    }

    return true;
  }

  /**
   * Clear all cached spans for a given rootSpanId.
   * Useful for explicit cleanup after scoring completes.
   */
  clear(rootSpanId: string): void {
    this.cache.delete(rootSpanId);
  }

  /**
   * Clear all cached data.
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get the number of root spans currently cached.
   */
  get size(): number {
    return this.cache.size;
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxRootSpans) {
      return;
    }

    // Find and remove the oldest entry
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
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
