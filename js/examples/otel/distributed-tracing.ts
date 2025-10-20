#!/usr/bin/env tsx
/**
 * Example: Distributed Tracing between Braintrust and OpenTelemetry
 *
 * This example demonstrates how to propagate trace context across service boundaries
 * using Braintrust span.export() and OpenTelemetry. This enables unified distributed
 * tracing where a Braintrust span in one service can be the parent of an OTEL span
 * in another service.
 *
 * Key concepts:
 * - Service A creates a Braintrust span and exports the context
 * - The exported context is passed to Service B (simulated as function call)
 * - Service B uses otelContextFromSpanExport() to create child OTEL spans
 * - All spans share the same trace_id and maintain proper parent relationships
 *
 * Requirements:
 * - @opentelemetry/api
 * - @opentelemetry/sdk-trace-base
 * - @opentelemetry/context-async-hooks (for Node.js context propagation)
 *
 * Run with: BRAINTRUST_OTEL_COMPAT=true tsx examples/otel/distributed-tracing.ts
 */

import * as api from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import {
  initLogger,
  login,
  otelContextFromSpanExport,
} from "../../dist/index.js";

const { trace, context } = api;

const PROJECT_NAME = "distributed-tracing-demo";

/**
 * Setup OTEL instrumentation.
 * In a real application, this would be in Service B's initialization.
 */
function setupOtel() {
  const provider = new BasicTracerProvider();

  // Set as global tracer provider
  trace.setGlobalTracerProvider(provider);

  return trace.getTracer("service-b", "1.0.0");
}

/**
 * Service B: Receives exported context from Service A and creates child OTEL spans.
 *
 * In a real distributed system, exported_context would be received via HTTP headers,
 * message queue metadata, or other inter-service communication mechanisms.
 */
async function serviceBProcessRequest(
  exportedContext: string,
  tracer: ReturnType<typeof trace.getTracer>,
) {
  console.log("\n=== Service B: User Service ===");

  // Import the context from Service A
  const ctx = otelContextFromSpanExport(exportedContext);

  // Use context.with() to run code in the imported context
  await context.with(ctx, async () => {
    await tracer.startActiveSpan("service_b.root", async (fetchSpan) => {
      // Nested operation in Service B
      await tracer.startActiveSpan("service_b.child", async (childSpan) => {
        const traceId = fetchSpan.spanContext().traceId;
        console.log(
          `  Created OTEL child spans (trace_id: ${traceId.slice(0, 16)}...)`,
        );
        childSpan.end();
      });
      fetchSpan.end();
    });
  });
}

async function main() {
  console.log("Distributed Tracing Example: Braintrust → OpenTelemetry\n");
  console.log("This example simulates a distributed system with 2 services:");
  console.log("  1. Service A (Braintrust span)");
  console.log("  2. Service B (OTEL span)\n");

  // Enable OTEL compatibility mode
  if (process.env.BRAINTRUST_OTEL_COMPAT !== "true") {
    console.error(
      "❌ Please set BRAINTRUST_OTEL_COMPAT=true to run this example",
    );
    process.exit(1);
  }

  // Try to import AsyncHooksContextManager - required for context propagation
  let AsyncHooksContextManager: any;
  try {
    const contextAsyncHooks = await import(
      "@opentelemetry/context-async-hooks"
    );
    AsyncHooksContextManager = contextAsyncHooks.AsyncHooksContextManager;
  } catch (e) {
    console.error("⚠️  @opentelemetry/context-async-hooks not found.");
    console.error(
      "   Install it with: npm install @opentelemetry/context-async-hooks",
    );
    console.error(
      "   This package is required for OTEL context propagation in Node.js",
    );
    process.exit(1);
  }

  // Register AsyncHooksContextManager for context propagation
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  // Setup
  await login();
  const tracer = setupOtel();
  const logger = initLogger({ projectName: PROJECT_NAME });

  console.log("=== Service A ===");
  await logger.traced(
    async (gatewaySpan) => {
      const traceId = gatewaySpan.rootSpanId;
      const spanId = gatewaySpan.spanId;
      console.log(
        `  Created span (trace_id: ${traceId.slice(0, 16)}..., span_id: ${spanId.slice(0, 8)}...)`,
      );
      console.log(`  Link: ${gatewaySpan.link()}`);

      // Export context for distributed tracing
      // In a real system, this would be sent as HTTP headers like:
      //   X-Braintrust-Context: <exported_context>
      const exportedContext = await gatewaySpan.export();
      console.log("\n  → Sending request to Service B with exported context");

      // Call Service B with the exported context
      await serviceBProcessRequest(exportedContext, tracer);
    },
    { name: "service_a.root" },
  );

  // Flush all data
  await logger.flush();
  const provider = trace.getTracerProvider() as BasicTracerProvider;
  if (provider.forceFlush) {
    await provider.forceFlush();
  }

  console.log("\n✓ Trace complete! Both services share the same trace_id");
  console.log(
    `  View in Braintrust: https://www.braintrust.dev/app/braintrust.dev/p/${PROJECT_NAME}`,
  );
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
