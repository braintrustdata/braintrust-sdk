import { expect, test } from "vitest";
import { middlewareFromEnv } from "./env";

/** Names of the middleware each recording's stack would contain, in order. */
const stack = (env: Record<string, string | undefined>) =>
  middlewareFromEnv(env)?.().map((middleware) => middleware.name);

test("names the middleware in order", () => {
  expect(stack({ BRAINTRUST_AUDIO_MIDDLEWARE: "opus, ogg" })).toEqual([
    "opus",
    "ogg",
  ]);
});

test.each(["true", "1", "TRUE"])(
  "compression %s means opus then ogg",
  (value) => {
    expect(stack({ BRAINTRUST_AUDIO_COMPRESSION: value })).toEqual([
      "opus",
      "ogg",
    ]);
  },
);

test("names ignore case and empty entries", () => {
  expect(stack({ BRAINTRUST_AUDIO_MIDDLEWARE: "OPUS,, Ogg," })).toEqual([
    "opus",
    "ogg",
  ]);
  expect(
    middlewareFromEnv({ BRAINTRUST_AUDIO_MIDDLEWARE: " , " }),
  ).toBeUndefined();
});

test("an explicit list wins over the compression shortcut", () => {
  expect(
    stack({
      BRAINTRUST_AUDIO_COMPRESSION: "true",
      BRAINTRUST_AUDIO_MIDDLEWARE: "ogg",
    }),
  ).toEqual(["ogg"]);
});

test.each([
  {},
  { BRAINTRUST_AUDIO_COMPRESSION: "false" },
  { BRAINTRUST_AUDIO_MIDDLEWARE: " " },
])("asks for nothing with %j", (env) => {
  expect(middlewareFromEnv(env)).toBeUndefined();
});

test("unknown names are rejected with the known names", () => {
  expect(() =>
    middlewareFromEnv({ BRAINTRUST_AUDIO_MIDDLEWARE: "opus,mp3" }),
  ).toThrow(
    'Unknown audio middleware "mp3" in BRAINTRUST_AUDIO_MIDDLEWARE (known: opus, ogg)',
  );
});

test("each recording gets new middleware instances", () => {
  const factory = middlewareFromEnv({ BRAINTRUST_AUDIO_COMPRESSION: "true" })!;
  const [a, b] = [factory(), factory()];
  expect(a[0]).not.toBe(b[0]);
});

test("importing the package registers it for the SDK", async () => {
  await import("./index");
  const registry = (globalThis as Record<symbol, unknown>)[
    Symbol.for("braintrust.audio")
  ] as { version: number; middlewareFromEnv: unknown };
  expect(registry.version).toBe(1);
  expect(registry.middlewareFromEnv).toBe(middlewareFromEnv);
});
