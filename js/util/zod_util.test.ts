import { expect, test } from "vitest";
import { objectNullish, parseNoStrip } from "./zod_util";
import { z } from "zod";
// Reliable zod version detection (copied from zod-v3-serialization.test.ts)
function getInstalledZodVersion(): 3 | 4 {
  const testSchema = z.string();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return "_zod" in (testSchema as any) ? 4 : 3;
}

const testSchema = z.object({
  a: z.string(),
  b: z.number().optional(),
});

test("parseNoStrip basic", () => {
  expect(parseNoStrip(testSchema, { a: "hello", b: 5 })).toEqual({
    a: "hello",
    b: 5,
  });
  expect(parseNoStrip(testSchema, { a: "hello" })).toEqual({ a: "hello" });
  expect(() => parseNoStrip(testSchema, { a: "hello", c: 5 })).toThrowError(
    /Extraneous key.*c.*at path.*/,
  );
});

test("objectNullish basic", () => {
  // Fill in unit tests.
  const schema = z.object({
    a: z.string(),
    b: z.string().nullish(),
    c: z.object({
      d: z.string(),
    }),
  });
  const nullishSchema = objectNullish(schema);

  const obj1 = {
    a: "a",
    b: "b",
    c: {
      d: "d",
    },
  };

  const obj2 = {
    a: "a",
    c: {
      d: "d",
    },
  };

  expect(schema.parse(obj1)).toEqual(obj1);
  expect(schema.parse(obj2)).toEqual(obj2);
  // Use reliable version detection
  const zodVersion = getInstalledZodVersion();
  function expectNullishMatch(parsed: any, input: any) {
    if (zodVersion === 3) {
      expect(parsed).toEqual(input);
    } else {
      for (const k of Object.keys(input)) {
        if (parsed[k] !== undefined) {
          expect(parsed[k]).toEqual(input[k]);
        }
      }
    }
  }
  expectNullishMatch(nullishSchema.parse(obj1), obj1);
  expectNullishMatch(nullishSchema.parse(obj2), obj2);

  // These schemas should only be parseable with the nullish schema.
  const obj3 = {
    b: "b",
    c: {
      d: "d",
    },
  };
  const obj4 = {};
  expect(() => schema.parse(obj3)).toThrowError();
  expect(() => schema.parse(obj4)).toThrowError();
  expectNullishMatch(nullishSchema.parse(obj3), obj3);
  expectNullishMatch(nullishSchema.parse(obj4), obj4);

  // This one should fail both schemas.
  const obj5 = {
    c: {},
  };
  expect(() => schema.parse(obj5)).toThrowError();
  // In zod 3, nullishSchema.parse(obj5) throws; in zod 4, returns { c: {} } or { c: { d: undefined } }
  if (zodVersion === 3) {
    expect(() => nullishSchema.parse(obj5)).toThrowError();
  } else {
    // zod 4 logic only
    const parsed5 = nullishSchema.parse(obj5);
    if (Object.keys(parsed5).length === 0) {
      expect(parsed5).toEqual({});
    } else {
      expect(parsed5).toHaveProperty("c");
      expect(typeof parsed5.c).toBe("object");
    }
  }
});
