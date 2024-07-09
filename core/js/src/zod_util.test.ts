import { expect, test } from "vitest";
import { parseNoStrip } from "./zod_util";
import { z } from "zod";

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
    /Extraneous key.*c.*at path.*in input/,
  );
});
