import { expect, test, vi } from "vitest";
import { resolveEncoder } from "./encoding";

test("WAV never loads the optional codec", () => {
  const load = vi.fn();
  expect(resolveEncoder("wav", load)).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});
test.each([undefined, "ogg"] as const)(
  "%s uses compression when installed and WAV otherwise",
  (format) => {
    const codec = { module: "file:///codec.mjs" };
    expect(resolveEncoder(format, () => ({ oggOpus: () => codec }))).toBe(
      codec,
    );
    expect(
      resolveEncoder(format, () => {
        throw new Error("not installed");
      }),
    ).toBeUndefined();
  },
);
