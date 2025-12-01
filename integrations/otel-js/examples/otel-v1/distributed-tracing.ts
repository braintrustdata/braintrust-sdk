#!/usr/bin/env tsx
/**
 * Minimal example: Distributed Tracing BT → OTEL → BT
 *
 * Run with: tsx examples/otel/distributed-tracing.ts
 */

import * as api from "@opentelemetry/api";
import {
  BasicTracerProvider,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { initLogger, login } from "braintrust";
import {
  contextFromSpanExport,
  addSpanParentToBaggage,
  parentFromHeaders,
  BraintrustSpanProcessor,
  setupOtelCompat,
} from "@braintrust/otel";

const { trace, context, propagation } = api;

setupOtelCompat();

async function main() {
  // Setup OTEL
  const provider = new BasicTracerProvider({
    resource: new Resource({
      "service.name": "service-b",
    }),
  });
  // Type assertion needed for OTel version compatibility
  (provider as any).addSpanProcessor(
    new BraintrustSpanProcessor() as unknown as SpanProcessor,
  );
  trace.setGlobalTracerProvider(provider);
  const tracer = trace.getTracer("service-b");

  // Setup context manager
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  await login();
  const logger = initLogger({ projectName: "otel-v1-examples" });

  // Service A (Braintrust) → Service B (OTEL) → Service C (Braintrust)
  let spanLink = "";
  await logger.traced(async (spanA) => {
    spanLink = spanA.link();
    const exported = await spanA.export();

    // Service B (OTEL)
    const ctx = contextFromSpanExport(exported);
    await context.with(ctx, async () => {
      await tracer.startActiveSpan("service_b", async (spanB) => {
        // Export to Service C
        // Add braintrust.parent to baggage for propagation
        const currentCtx = context.active();
        const updatedCtx = addSpanParentToBaggage(spanB, currentCtx);
        if (!updatedCtx) {
          console.warn(
            "Warning: Could not add braintrust.parent to baggage. " +
              "The span may not have the braintrust.parent attribute set.",
          );
        }
        const headers: Record<string, string> = {};
        // Use the updated context if available, otherwise fall back to current
        const ctxToUse = (updatedCtx || currentCtx) as api.Context;
        propagation.inject(ctxToUse, headers);

        // Service C (Braintrust)
        const parent = parentFromHeaders(headers);
        await logger.traced(
          async (spanC) => {
            spanC.log({ input: "from service B" });
          },
          { name: "service_c", parent },
        );

        spanB.end();
      });
    });
  });

  await logger.flush();
  await provider.forceFlush();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`\nView trace: ${spanLink}`);
}

main().catch(console.error);
