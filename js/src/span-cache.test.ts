import { describe, expect, test, beforeEach, vi } from "vitest";
import { SpanCache } from "./span-cache";

describe("SpanCache", () => {
  let cache: SpanCache;

  beforeEach(() => {
    cache = new SpanCache();
  });

  describe("write and read", () => {
    test("should store and retrieve spans by rootSpanId", () => {
      const rootSpanId = "root-123";
      const span1 = {
        span_id: "span-1",
        input: { text: "hello" },
        output: { response: "world" },
      };
      const span2 = {
        span_id: "span-2",
        input: { text: "foo" },
        output: { response: "bar" },
      };

      cache.write(rootSpanId, span1.span_id, span1);
      cache.write(rootSpanId, span2.span_id, span2);

      const spans = cache.getByRootSpanId(rootSpanId);
      expect(spans).toHaveLength(2);
      expect(spans).toContainEqual(span1);
      expect(spans).toContainEqual(span2);
    });

    test("should return undefined for unknown rootSpanId", () => {
      const spans = cache.getByRootSpanId("nonexistent");
      expect(spans).toBeUndefined();
    });

    test("should merge span data on subsequent writes to same spanId", () => {
      const rootSpanId = "root-123";
      const spanId = "span-1";

      cache.write(rootSpanId, spanId, {
        span_id: spanId,
        input: { text: "hello" },
      });

      cache.write(rootSpanId, spanId, {
        span_id: spanId,
        output: { response: "world" },
      });

      const spans = cache.getByRootSpanId(rootSpanId);
      expect(spans).toHaveLength(1);
      expect(spans![0]).toEqual({
        span_id: spanId,
        input: { text: "hello" },
        output: { response: "world" },
      });
    });

    test("should merge metadata objects", () => {
      const rootSpanId = "root-123";
      const spanId = "span-1";

      cache.write(rootSpanId, spanId, {
        span_id: spanId,
        metadata: { key1: "value1" },
      });

      cache.write(rootSpanId, spanId, {
        span_id: spanId,
        metadata: { key2: "value2" },
      });

      const spans = cache.getByRootSpanId(rootSpanId);
      expect(spans![0].metadata).toEqual({
        key1: "value1",
        key2: "value2",
      });
    });
  });

  describe("has", () => {
    test("should return true when rootSpanId exists", () => {
      cache.write("root-123", "span-1", { span_id: "span-1" });
      expect(cache.has("root-123")).toBe(true);
    });

    test("should return false when rootSpanId does not exist", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });
  });

  describe("clear", () => {
    test("should remove spans for a specific rootSpanId", () => {
      cache.write("root-1", "span-1", { span_id: "span-1" });
      cache.write("root-2", "span-2", { span_id: "span-2" });

      cache.clear("root-1");

      expect(cache.has("root-1")).toBe(false);
      expect(cache.has("root-2")).toBe(true);
    });
  });

  describe("clearAll", () => {
    test("should remove all cached spans", () => {
      cache.write("root-1", "span-1", { span_id: "span-1" });
      cache.write("root-2", "span-2", { span_id: "span-2" });

      cache.clearAll();

      expect(cache.size).toBe(0);
    });
  });

  describe("eviction", () => {
    test("should evict oldest entries when maxRootSpans is exceeded", () => {
      const smallCache = new SpanCache({ maxRootSpans: 2 });

      smallCache.write("root-1", "span-1", { span_id: "span-1" });
      smallCache.write("root-2", "span-2", { span_id: "span-2" });
      smallCache.write("root-3", "span-3", { span_id: "span-3" });

      expect(smallCache.size).toBe(2);
      expect(smallCache.has("root-1")).toBe(false); // Oldest evicted
      expect(smallCache.has("root-2")).toBe(true);
      expect(smallCache.has("root-3")).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    test("should return undefined for expired entries", () => {
      vi.useFakeTimers();

      const shortTtlCache = new SpanCache({ ttlMs: 1000 }); // 1 second TTL
      shortTtlCache.write("root-1", "span-1", { span_id: "span-1" });

      expect(shortTtlCache.has("root-1")).toBe(true);

      // Advance time past TTL
      vi.advanceTimersByTime(2000);

      expect(shortTtlCache.has("root-1")).toBe(false);
      expect(shortTtlCache.getByRootSpanId("root-1")).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe("size", () => {
    test("should return the number of root spans", () => {
      expect(cache.size).toBe(0);

      cache.write("root-1", "span-1", { span_id: "span-1" });
      expect(cache.size).toBe(1);

      cache.write("root-1", "span-2", { span_id: "span-2" }); // Same root
      expect(cache.size).toBe(1);

      cache.write("root-2", "span-3", { span_id: "span-3" }); // Different root
      expect(cache.size).toBe(2);
    });
  });
});
