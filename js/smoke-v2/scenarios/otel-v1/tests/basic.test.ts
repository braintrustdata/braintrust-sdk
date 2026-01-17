import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { setupMockOtlpCollector } from "../src/test-helpers.js";

async function main() {
  const collector = await setupMockOtlpCollector();

  const previousApiUrl = process.env.BRAINTRUST_API_URL;
  process.env.BRAINTRUST_API_URL = collector.url;

  try {
    // Use real OpenTelemetry SDK with BraintrustSpanProcessor
    const sdk = new NodeSDK({
      serviceName: "test-service",
      spanProcessor: new BraintrustSpanProcessor() as unknown as SpanProcessor,
    });

    await sdk.start();

    try {
      const tracer = trace.getTracer("test-tracer");
      await tracer.startActiveSpan("test-span", async (span) => {
        span.setAttributes({ "test.attr": "value" });
        span.end();
      });
    } finally {
      await sdk.shutdown();
    }

    await delay(50); // Let exports flush

    assert.ok(collector.payloads.length > 0, "No spans exported");
    console.log("✓ Basic OTEL span export test passed");
  } finally {
    process.env.BRAINTRUST_API_URL = previousApiUrl;
    await collector.cleanup();
  }
}

main().catch((err) => {
  console.error("✗ Test failed:", err);
  process.exit(1);
});
