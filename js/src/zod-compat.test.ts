/**
 * Tests for zod compatibility layer
 *
 * These tests verify that the zod-compat module works correctly
 * with both zod 3.x and 4.x versions.
 */

import { expect, test, describe } from "vitest";
import { z, ZodError } from "./zod-compat";
import { zodToJsonSchema } from "./zod-to-json-compat";

describe("zod-compat", () => {
  test("basic schema creation works", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const valid = { name: "John", age: 30 };
    const result = schema.parse(valid);
    expect(result).toEqual(valid);
  });

  test("schema validation throws ZodError on invalid data", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const invalid = { name: "John", age: "thirty" };

    expect(() => schema.parse(invalid)).toThrow(ZodError);
  });

  test("complex nested schemas work", () => {
    const userSchema = z.object({
      id: z.string(),
      profile: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      tags: z.array(z.string()),
      metadata: z.record(z.unknown()),
    });

    const validUser = {
      id: "123",
      profile: {
        name: "Alice",
        email: "alice@example.com",
      },
      tags: ["admin", "user"],
      metadata: { foo: "bar", count: 42 },
    };

    const result = userSchema.parse(validUser);
    expect(result).toEqual(validUser);
  });

  test("zod-to-json-schema works with schemas", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      active: z.boolean().default(true),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema).toBeDefined();
    expect(jsonSchema).toHaveProperty("type", "object");
    expect(jsonSchema).toHaveProperty("properties");
  });

  test("function parameter schemas work", () => {
    const paramsSchema = z.object({
      input: z.string(),
      options: z
        .object({
          verbose: z.boolean().default(false),
          maxLength: z.number().optional(),
        })
        .optional(),
    });

    const returnsSchema = z.object({
      output: z.string(),
      length: z.number(),
    });

    // Simulate a function schema
    const functionSchema = {
      parameters: paramsSchema,
      returns: returnsSchema,
    };

    // Test parameter validation
    const validParams = {
      input: "test",
      options: { verbose: true },
    };
    expect(functionSchema.parameters.parse(validParams)).toEqual(validParams);

    // Test return value validation
    const validReturn = {
      output: "processed",
      length: 9,
    };
    expect(functionSchema.returns.parse(validReturn)).toEqual(validReturn);
  });

  test("enum schemas work", () => {
    const statusSchema = z.enum(["pending", "active", "completed"]);

    expect(statusSchema.parse("pending")).toBe("pending");
    expect(statusSchema.parse("active")).toBe("active");
    expect(() => statusSchema.parse("invalid")).toThrow(ZodError);
  });

  test("union schemas work", () => {
    const schema = z.union([z.string(), z.number()]);

    expect(schema.parse("hello")).toBe("hello");
    expect(schema.parse(42)).toBe(42);
    expect(() => schema.parse(true)).toThrow(ZodError);
  });

  test("optional and nullable work", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
    });

    const valid1 = { required: "test", nullable: null };
    expect(schema.parse(valid1)).toEqual({
      required: "test",
      nullable: null,
    });

    const valid2 = {
      required: "test",
      optional: "value",
      nullable: null,
    };
    expect(schema.parse(valid2)).toEqual(valid2);
  });

  test("default values work", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().default(0),
      enabled: z.boolean().default(true),
    });

    const input = { name: "test" };
    const result = schema.parse(input);

    expect(result).toEqual({
      name: "test",
      count: 0,
      enabled: true,
    });
  });

  test("refinement/transform works", () => {
    const schema = z
      .string()
      .transform((val) => val.toUpperCase())
      .refine((val) => val.length > 0, {
        message: "String must not be empty",
      });

    expect(schema.parse("hello")).toBe("HELLO");
    expect(() => schema.parse("")).toThrow(ZodError);
  });

  test("literal schemas work", () => {
    const typeSchema = z.literal("json_schema");

    expect(typeSchema.parse("json_schema")).toBe("json_schema");
    expect(() => typeSchema.parse("other")).toThrow(ZodError);
  });

  test("infer type works", () => {
    const schema = z.object({
      id: z.string(),
      value: z.number(),
    });

    type InferredType = z.infer<typeof schema>;

    // This is a compile-time check
    const value: InferredType = {
      id: "123",
      value: 42,
    };

    expect(schema.parse(value)).toEqual(value);
  });

  test("strict object validation works", () => {
    const strictSchema = z.strictObject({
      allowed: z.string(),
    });

    expect(strictSchema.parse({ allowed: "value" })).toEqual({
      allowed: "value",
    });

    // Extra keys should be stripped in non-strict mode
    const nonStrictSchema = z.object({
      allowed: z.string(),
    });
    expect(nonStrictSchema.parse({ allowed: "value", extra: "data" })).toEqual({
      allowed: "value",
    });
  });

  test("instanceof checks work for ZodType", () => {
    const schema = z.string();

    // Check that _def exists (internal zod structure)
    expect(schema).toHaveProperty("_def");
    expect(typeof schema._def).toBe("object");
  });
});
