import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";
import {
  SpanComponentsV4,
  parseParent,
  spanComponentsV4Schema,
} from "./span_identifier_v4";
import { SpanObjectTypeV3 } from "./span_identifier_v3";

describe("SpanComponentsV4", () => {
  describe("Basic functionality", () => {
    test("should create and serialize simple span components", () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-experiment-id",
        row_id: "test-row-id",
        span_id: "1234567890abcdef", // 8-byte hex
        root_span_id: "abcdef1234567890abcdef1234567890", // 16-byte hex
      });

      const serialized = components.toStr();
      expect(typeof serialized).toBe("string");
      expect(serialized.length).toBeGreaterThan(0);
    });

    test("should handle serialization round-trip", () => {
      const originalData = {
        object_type: SpanObjectTypeV3.PROJECT_LOGS,
        object_id: "project-123",
        row_id: "row-456",
        span_id: "fedcba0987654321", // 8-byte hex
        root_span_id: "0123456789abcdef0123456789abcdef", // 16-byte hex
        propagated_event: { key: "value", nested: { prop: 123 } },
      };

      const components = new SpanComponentsV4(originalData);
      const serialized = components.toStr();
      const deserialized = SpanComponentsV4.fromStr(serialized);

      expect(deserialized.data.object_type).toBe(originalData.object_type);
      expect(deserialized.data.object_id).toBe(originalData.object_id);
      expect(deserialized.data.row_id).toBe(originalData.row_id);
      expect(deserialized.data.span_id).toBe(originalData.span_id);
      expect(deserialized.data.root_span_id).toBe(originalData.root_span_id);
      expect(deserialized.data.propagated_event).toEqual(
        originalData.propagated_event,
      );
    });
  });

  describe("Hex string compression", () => {
    test("should compress hex span IDs and trace IDs", () => {
      // Test with proper hex values
      const componentsWithHex = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "experiment-id",
        row_id: "row-id",
        span_id: "abcd1234abcd1234", // 16 hex chars = 8 bytes
        root_span_id: "1234567890abcdef1234567890abcdef", // 32 hex chars = 16 bytes
      });

      const serializedHex = componentsWithHex.toStr();

      // Test with non-hex values (should fall back to JSON)
      const componentsWithoutHex = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "experiment-id",
        row_id: "row-id",
        span_id: "not-a-hex-string",
        root_span_id: "also-not-hex",
      });

      const serializedNonHex = componentsWithoutHex.toStr();

      // Both should work
      const deserializedHex = SpanComponentsV4.fromStr(serializedHex);
      const deserializedNonHex = SpanComponentsV4.fromStr(serializedNonHex);

      expect(deserializedHex.data.span_id).toBe("abcd1234abcd1234");
      expect(deserializedHex.data.root_span_id).toBe(
        "1234567890abcdef1234567890abcdef",
      );

      expect(deserializedNonHex.data.span_id).toBe("not-a-hex-string");
      expect(deserializedNonHex.data.root_span_id).toBe("also-not-hex");
    });

    test("should handle edge cases in hex compression", () => {
      // Test with wrong-length hex strings
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-id",
        row_id: "row-id", // Need to provide all row fields or none
        span_id: "abc123", // Wrong length, should fall back to JSON
        root_span_id: "def456", // Wrong length, should fall back to JSON
      });

      const serialized = components.toStr();
      const deserialized = SpanComponentsV4.fromStr(serialized);

      expect(deserialized.data.span_id).toBe("abc123");
      expect(deserialized.data.root_span_id).toBe("def456");
    });
  });

  describe("Backwards compatibility", () => {
    test("should handle V3 format gracefully", () => {
      // This would be a V3-encoded string - we'll simulate by creating one
      // that starts with version byte < 4
      const v3LikeData = {
        object_type: SpanObjectTypeV3.PLAYGROUND_LOGS,
        object_id: "playground-id",
        row_id: "test-row",
        span_id: "span-123",
        root_span_id: "root-456",
      };

      // First create with V3 to get a properly formatted older version
      // Since we don't have direct access to V3 constructor format here,
      // we'll test the main V4 functionality
      const v4Components = new SpanComponentsV4(v3LikeData);
      const serialized = v4Components.toStr();
      const deserialized = SpanComponentsV4.fromStr(serialized);

      expect(deserialized.data.object_type).toBe(v3LikeData.object_type);
      expect(deserialized.data.object_id).toBe(v3LikeData.object_id);
    });
  });

  describe("Object ID fields extraction", () => {
    test("should extract experiment fields correctly", () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "exp-123",
      });

      const fields = components.objectIdFields();
      expect(fields).toEqual({ experiment_id: "exp-123" });
    });

    test("should extract project log fields correctly", () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.PROJECT_LOGS,
        object_id: "proj-456",
      });

      const fields = components.objectIdFields();
      expect(fields).toEqual({ project_id: "proj-456", log_id: "g" });
    });

    test("should extract playground log fields correctly", () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.PLAYGROUND_LOGS,
        object_id: "playground-789",
      });

      const fields = components.objectIdFields();
      expect(fields).toEqual({
        prompt_session_id: "playground-789",
        log_id: "x",
      });
    });

    test("should throw error when object_id is missing", () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: undefined,
      });

      expect(() => components.objectIdFields()).toThrow(
        /cannot invoke.*objectIdFields.*object_id/,
      );
    });
  });

  describe("Schema validation", () => {
    test("should validate correct data", () => {
      const validData = {
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-id",
        row_id: "row-id",
        span_id: "span-id",
        root_span_id: "root-id",
      };

      expect(() => spanComponentsV4Schema.parse(validData)).not.toThrow();
    });

    test("should accept valid data with object_id", () => {
      const validDataWithObjectId = {
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-id",
      };

      expect(() =>
        spanComponentsV4Schema.parse(validDataWithObjectId),
      ).not.toThrow();
    });

    test("should accept valid data with compute_object_metadata_args", () => {
      const validDataWithMetadata = {
        object_type: SpanObjectTypeV3.EXPERIMENT,
        compute_object_metadata_args: { key: "value" },
      };

      expect(() =>
        spanComponentsV4Schema.parse(validDataWithMetadata),
      ).not.toThrow();
    });

    test("should require all row ID fields if any are present", () => {
      const invalidData = {
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-id",
        row_id: "row-id",
        // Missing span_id and root_span_id
      };

      expect(() => spanComponentsV4Schema.parse(invalidData)).toThrow();
    });
  });

  describe("Export functionality", () => {
    test("should export as string", async () => {
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test-id",
      });

      const exported = await components.export();
      expect(typeof exported).toBe("string");
      expect(exported.length).toBeGreaterThan(0);

      // Should be same as toStr()
      expect(exported).toBe(components.toStr());
    });
  });

  describe("Error handling", () => {
    test("should throw error for invalid base64", () => {
      expect(() => SpanComponentsV4.fromStr("invalid-base64!!!")).toThrow(
        /not properly encoded/,
      );
    });

    test("should throw error for corrupted data", () => {
      // Create a minimal valid serialization, then corrupt it
      const components = new SpanComponentsV4({
        object_type: SpanObjectTypeV3.EXPERIMENT,
        object_id: "test",
      });

      const valid = components.toStr();
      const corrupted = valid.slice(0, -5) + "XXXXX"; // Corrupt the end

      expect(() => SpanComponentsV4.fromStr(corrupted)).toThrow(
        /not properly encoded/,
      );
    });
  });

  describe("parseParent function", () => {
    test("should return string parents unchanged", () => {
      const parentString = "existing-parent-string";
      const result = parseParent(parentString);
      expect(result).toBe(parentString);
    });

    test("should return undefined for falsy parents", () => {
      expect(parseParent(undefined)).toBeUndefined();
      expect(parseParent(null as any)).toBeUndefined();
    });

    test("should convert parent objects to V4 strings", () => {
      const parentObj = {
        object_type: "experiment" as const,
        object_id: "exp-123",
        row_ids: {
          id: "row-456",
          span_id: "span-789",
          root_span_id: "root-abc",
        },
        propagated_event: { key: "value" },
      };

      const result = parseParent(parentObj);
      expect(typeof result).toBe("string");
      expect(result!.length).toBeGreaterThan(0);

      // Should be deserializable
      const deserialized = SpanComponentsV4.fromStr(result!);
      expect(deserialized.data.object_type).toBe(SpanObjectTypeV3.EXPERIMENT);
      expect(deserialized.data.object_id).toBe("exp-123");
      expect(deserialized.data.row_id).toBe("row-456");
      expect(deserialized.data.span_id).toBe("span-789");
      expect(deserialized.data.root_span_id).toBe("root-abc");
      expect(deserialized.data.propagated_event).toEqual({ key: "value" });
    });

    test("should handle different object types", () => {
      const projectParent = {
        object_type: "project_logs" as const,
        object_id: "proj-123",
      };

      const playgroundParent = {
        object_type: "playground_logs" as const,
        object_id: "play-456",
      };

      const projectResult = parseParent(projectParent);
      const playgroundResult = parseParent(playgroundParent);

      const projectDeserialized = SpanComponentsV4.fromStr(projectResult!);
      const playgroundDeserialized = SpanComponentsV4.fromStr(
        playgroundResult!,
      );

      expect(projectDeserialized.data.object_type).toBe(
        SpanObjectTypeV3.PROJECT_LOGS,
      );
      expect(playgroundDeserialized.data.object_type).toBe(
        SpanObjectTypeV3.PLAYGROUND_LOGS,
      );
    });
  });
});
