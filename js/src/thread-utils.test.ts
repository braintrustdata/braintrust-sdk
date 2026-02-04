import { describe, expect, it } from "vitest";
import {
  formatMessageArrayAsText,
  IncrementalMerger,
  mergeAndStringify,
  stringifyPreprocessorResult,
} from "./thread-utils";

describe("thread-utils stringification", () => {
  it("stringifyPreprocessorResult truncates by default", () => {
    const text = "a".repeat(120_000);
    const result = stringifyPreprocessorResult(text);
    expect(result).not.toBeNull();
    expect(result).toContain("[middle truncated]");
    if (result === null) {
      throw new Error("expected result");
    }
    expect(result.length).toBeLessThan(text.length);
  });

  it("stringifyPreprocessorResult respects maxBytes", () => {
    const text = "b".repeat(200);
    const truncated = stringifyPreprocessorResult(text, { maxBytes: 50 });
    const full = stringifyPreprocessorResult(text, { maxBytes: 500 });
    expect(truncated).toContain("[middle truncated]");
    expect(full).toBe(text);
  });

  it("formatMessageArrayAsText truncates across message parts", () => {
    const messages = [
      { role: "user", content: "U".repeat(80) },
      { role: "assistant", content: "A".repeat(80) },
      { role: "user", content: "Z".repeat(80) },
    ];
    const text = formatMessageArrayAsText(messages, { maxBytes: 120 });
    expect(text).toContain("[middle truncated]");
    expect(text).toContain("User:");
    expect(text).toContain("U");
    expect(text).toContain("Z");
  });

  it("IncrementalMerger and mergeAndStringify honor maxBytes", () => {
    const merger = new IncrementalMerger({ maxBytes: 60 });
    merger.add("c".repeat(120));
    const truncated = merger.stringify();
    const full = merger.stringify({ maxBytes: 200 });
    expect(truncated).toContain("[middle truncated]");
    expect(full).toBe("c".repeat(120));

    const merged = mergeAndStringify(["d".repeat(120)], { maxBytes: 60 });
    expect(merged).toContain("[middle truncated]");
  });
});
