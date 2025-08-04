import { test, assert, describe } from "vitest";
import { OpenAIAgentsTracingProcessor } from "./index";

describe("OpenAIAgentsTracingProcessor", () => {
  test("is instantiable", () => {
    const processor = new OpenAIAgentsTracingProcessor();
    assert.ok(processor);

    // Test methods exist
    assert.ok(typeof processor.onTraceStart === "function");
    assert.ok(typeof processor.onTraceEnd === "function");
    assert.ok(typeof processor.onSpanStart === "function");
    assert.ok(typeof processor.onSpanEnd === "function");
    assert.ok(typeof processor.shutdown === "function");
    assert.ok(typeof processor.forceFlush === "function");
  });
});