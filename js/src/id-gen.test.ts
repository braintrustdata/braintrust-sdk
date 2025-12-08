import { expect, test, describe } from "vitest";
import { UUIDGenerator } from "braintrust";

describe("ID Generation", () => {
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
});
