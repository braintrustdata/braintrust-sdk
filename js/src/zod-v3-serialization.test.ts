/**
 * Tests for zod v3 compatibility with makeEvalParametersSchema
 *
 * This file tests makeEvalParametersSchema specifically with zod v3.
 * See zod-v4-serialization.test.ts for zod v4 specific tests.
 */

import { test, describe, beforeEach, expect } from "vitest";
import * as zodModule from "zod";
import {
  testStringSchema,
  testNumberSchema,
  testObjectSchema,
  testEnumSchema,
  testArraySchema,
} from "./zod-serialization-test-shared";

// Detect which zod version is installed by checking for v4-specific properties
function getInstalledZodVersion(): 3 | 4 {
  const testSchema = zodModule.z.string();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "_zod" in (testSchema as any) ? 4 : 3;
}

describe("makeEvalParametersSchema with Zod v3", () => {
  beforeEach(() => {
    const version = getInstalledZodVersion();
    expect(version).toBe(3);
  });

  test("string schema serializes correctly", testStringSchema);
  test("number schema serializes correctly", testNumberSchema);
  test("object schema serializes correctly", testObjectSchema);
  test("enum schema serializes correctly", testEnumSchema);
  test("array schema serializes correctly", testArraySchema);
});
