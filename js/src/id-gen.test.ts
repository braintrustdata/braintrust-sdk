import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { UUIDGenerator, OTELIDGenerator, getIdGenerator } from "./id-gen";

describe("ID Generation", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original environment variable
    originalEnv = process.env.BRAINTRUST_OTEL_COMPAT;
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.BRAINTRUST_OTEL_COMPAT = originalEnv;
    } else {
      delete process.env.BRAINTRUST_OTEL_COMPAT;
    }
  });

  describe("UUIDGenerator", () => {
    test("implements IDGenerator interface and generates valid UUIDs", () => {
      const generator = new UUIDGenerator();

      // Test that UUID generators should share root_span_id for backwards compatibility
      expect(generator.shareRootSpanId()).toBe(true);

      // Test span ID generation
      const spanId1 = generator.getSpanId();
      const spanId2 = generator.getSpanId();

      expect(spanId1).not.toBe(spanId2);
      expect(typeof spanId1).toBe("string");
      expect(typeof spanId2).toBe("string");

      // Validate UUID format (36 characters with dashes)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(spanId1).toMatch(uuidRegex);
      expect(spanId2).toMatch(uuidRegex);

      // Test trace ID generation
      const traceId1 = generator.getTraceId();
      const traceId2 = generator.getTraceId();

      expect(traceId1).not.toBe(traceId2);
      expect(typeof traceId1).toBe("string");
      expect(typeof traceId2).toBe("string");
      expect(traceId1).toMatch(uuidRegex);
      expect(traceId2).toMatch(uuidRegex);
    });
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
      // Ensure environment variable is not set
      delete process.env.BRAINTRUST_OTEL_COMPAT;

      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(UUIDGenerator);
      expect(generator.shareRootSpanId()).toBe(true);
    });

    test("returns UUID generator when BRAINTRUST_OTEL_COMPAT is false", () => {
      process.env.BRAINTRUST_OTEL_COMPAT = "false";

      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(UUIDGenerator);
      expect(generator.shareRootSpanId()).toBe(true);
    });

    test("returns OTEL generator when BRAINTRUST_OTEL_COMPAT is true", () => {
      process.env.BRAINTRUST_OTEL_COMPAT = "true";

      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(OTELIDGenerator);
      expect(generator.shareRootSpanId()).toBe(false);
    });

    test("is case insensitive for environment variable", () => {
      process.env.BRAINTRUST_OTEL_COMPAT = "TRUE";

      const generator = getIdGenerator();
      expect(generator).toBeInstanceOf(OTELIDGenerator);

      process.env.BRAINTRUST_OTEL_COMPAT = "False";

      const generator2 = getIdGenerator();
      expect(generator2).toBeInstanceOf(UUIDGenerator);
    });
  });
});
