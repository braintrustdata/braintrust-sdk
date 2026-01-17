import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { setupMockOtlpCollector } from "../src/test-helpers.js";

type OtelPayload = {
  resourceSpans?: Array<{
    scopeSpans?: Array<{
      spans?: Array<{ name?: string }>;
    }>;
  }>;
};

function flattenSpans(payloads: OtelPayload[]) {
  return payloads.flatMap(
    (p) =>
      p.resourceSpans?.flatMap(
        (rs) => rs.scopeSpans?.flatMap((ss) => ss.spans ?? []) ?? [],
      ) ?? [],
  );
}

async function main() {
  const collector = await setupMockOtlpCollector();

  const previousApiUrl = process.env.BRAINTRUST_API_URL;
  process.env.BRAINTRUST_API_URL = collector.url;

  try {
    // Test filterAISpans option
    const sdk = new NodeSDK({
      serviceName: "filtering-test",
      spanProcessor: new BraintrustSpanProcessor({
        filterAISpans: true,
      }) as unknown as SpanProcessor,
    });

    await sdk.start();

    try {
      const tracer = trace.getTracer("test-tracer");

      await tracer.startActiveSpan("root.span", async (rootSpan) => {
        // This AI span should be exported
        await tracer.startActiveSpan("ai.span", async (aiSpan) => {
          aiSpan.setAttributes({ model: "gpt-4o-mini" });
          aiSpan.end();
        });

        // This non-AI span should be filtered out
        await tracer.startActiveSpan("logging.span", async (logSpan) => {
          logSpan.end();
        });

        rootSpan.end();
      });
    } finally {
      await sdk.shutdown();
    }

    await delay(50);

    const exportedSpans = flattenSpans(collector.payloads as OtelPayload[]);
    const names = exportedSpans
      .map((s) => s.name)
      .filter((n): n is string => !!n);

    // Root span should not be exported
    assert.ok(!names.includes("root.span"), "Root span should be filtered");

    // AI span should be exported
    assert.ok(names.includes("ai.span"), "AI span should be exported");

    // Non-AI span should be filtered
    assert.ok(
      !names.includes("logging.span"),
      "Logging span should be filtered",
    );

    console.log("✓ AI span filtering test passed");
  } finally {
    process.env.BRAINTRUST_API_URL = previousApiUrl;
    await collector.cleanup();
  }
}

main().catch((err) => {
  console.error("✗ Test failed:", err);
  process.exit(1);
});
