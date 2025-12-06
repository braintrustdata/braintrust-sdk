import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { UUIDGenerator, getIdGenerator } from "braintrust";
import { OTELIDGenerator } from "./otel";
import { setupOtelCompat, resetOtelCompat } from ".";

describe("ID Generation", () => {
  beforeEach(() => {
    setupOtelCompat();
  });

  afterEach(() => {
    resetOtelCompat();
  });

  describe("OTELIDGenerator", () => {
    test("generates OpenTelemetry-compatible hex IDs", () => {
      const generator = new OTELIDGenerator();

      // Test that OTEL generators should not share root_span_id
      expect(generator.shareRootSpanId()).toBe(false);

      // Test span ID generation (8 bytes = 16 hex characters)
      const spanId1 = generator.getSpanId();
      const spanId2 = generator.getSpanId();

      expect(spanId1).not.toBe(spanId2);
      expect(spanId1.length).toBe(16);
      expect(spanId2.length).toBe(16);
      expect(/^[0-9a-f]{16}$/.test(spanId1)).toBe(true);
      expect(/^[0-9a-f]{16}$/.test(spanId2)).toBe(true);

      // Test trace ID generation (16 bytes = 32 hex characters)
      const traceId1 = generator.getTraceId();
      const traceId2 = generator.getTraceId();

      expect(traceId1).not.toBe(traceId2);
      expect(traceId1.length).toBe(32);
      expect(traceId2.length).toBe(32);
      expect(/^[0-9a-f]{32}$/.test(traceId1)).toBe(true);
      expect(/^[0-9a-f]{32}$/.test(traceId2)).toBe(true);
    });
  });

  describe("getIdGenerator factory function", () => {
    test("returns UUID generator by default", () => {
      resetOtelCompat();

      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(UUIDGenerator);
      expect(generator.shareRootSpanId()).toBe(true);
    });

    test("returns OTEL generator when otel is initialized", () => {
      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(OTELIDGenerator);
      expect(generator.shareRootSpanId()).toBe(false);
    });
  });
});
