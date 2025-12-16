import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { SpanCache } from "./span-cache";

describe("SpanCache (disk-based)", () => {
  let cache: SpanCache;

  beforeEach(() => {
    cache = new SpanCache();
  });

  afterEach(() => {
    // Clean up temp file after each test
    cache.dispose();
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

      cache.writeSync(rootSpanId, span1.span_id, span1);
      cache.writeSync(rootSpanId, span2.span_id, span2);

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

      cache.writeSync(rootSpanId, spanId, {
        span_id: spanId,
        input: { text: "hello" },
      });

      cache.writeSync(rootSpanId, spanId, {
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

      cache.writeSync(rootSpanId, spanId, {
        span_id: spanId,
        metadata: { key1: "value1" },
      });

      cache.writeSync(rootSpanId, spanId, {
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
      cache.writeSync("root-123", "span-1", { span_id: "span-1" });
      expect(cache.has("root-123")).toBe(true);
    });

    test("should return false when rootSpanId does not exist", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });
  });

  describe("clear", () => {
    test("should remove spans for a specific rootSpanId from index", () => {
      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      cache.writeSync("root-2", "span-2", { span_id: "span-2" });

      cache.clear("root-1");

      expect(cache.has("root-1")).toBe(false);
      expect(cache.has("root-2")).toBe(true);
    });
  });

  describe("clearAll", () => {
    test("should remove all cached spans", () => {
      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      cache.writeSync("root-2", "span-2", { span_id: "span-2" });

      cache.clearAll();

      expect(cache.size).toBe(0);
    });
  });

  describe("size", () => {
    test("should return the number of root spans tracked", () => {
      expect(cache.size).toBe(0);

      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      expect(cache.size).toBe(1);

      cache.writeSync("root-1", "span-2", { span_id: "span-2" }); // Same root
      expect(cache.size).toBe(1);

      cache.writeSync("root-2", "span-3", { span_id: "span-3" }); // Different root
      expect(cache.size).toBe(2);
    });
  });

  describe("dispose", () => {
    test("should clean up and allow reuse", () => {
      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      expect(cache.size).toBe(1);

      cache.dispose();

      expect(cache.size).toBe(0);
      expect(cache.has("root-1")).toBe(false);

      // Should be able to write again after dispose
      cache.writeSync("root-2", "span-2", { span_id: "span-2" });
      expect(cache.size).toBe(1);
    });
  });

  describe("disable", () => {
    test("should prevent writes after disable() is called", () => {
      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      expect(cache.size).toBe(1);

      cache.disable();

      // Writes after disable should be no-ops
      cache.writeSync("root-2", "span-2", { span_id: "span-2" });
      expect(cache.size).toBe(1); // Still 1, not 2
    });

    test("should return undefined from getByRootSpanId after disable()", () => {
      cache.writeSync("root-1", "span-1", { span_id: "span-1" });
      expect(cache.getByRootSpanId("root-1")).toBeDefined();

      cache.disable();

      // Reads after disable return undefined
      expect(cache.getByRootSpanId("root-1")).toBeUndefined();
    });

    test("disabled getter should reflect disabled state", () => {
      expect(cache.disabled).toBe(false);
      cache.disable();
      expect(cache.disabled).toBe(true);
    });

    test("should be disabled from constructor option", () => {
      const disabledCache = new SpanCache({ disabled: true });
      expect(disabledCache.disabled).toBe(true);

      // Writes should be no-ops
      disabledCache.writeSync("root-1", "span-1", { span_id: "span-1" });
      expect(disabledCache.size).toBe(0);
      expect(disabledCache.getByRootSpanId("root-1")).toBeUndefined();

      disabledCache.dispose();
    });
  });
});
