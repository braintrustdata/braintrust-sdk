#!/usr/bin/env tsx
/**
 * Minimal example: Distributed Tracing BT → OTEL → BT
 *
 * Run with: tsx examples/otel/distributed-tracing.ts
 */

import * as api from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { initLogger, login } from "braintrust";
import {
  contextFromSpanExport,
  addSpanParentToBaggage,
  parentFromHeaders,
  BraintrustSpanProcessor,
  initOtel,
} from "../src";

const { trace, context, propagation } = api;

initOtel();

async function main() {
  // Setup OTEL
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new BraintrustSpanProcessor());
  trace.setGlobalTracerProvider(provider);
  const tracer = trace.getTracer("service-b");

  // Setup context manager
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  await login();
  const logger = initLogger({ projectName: "otel-demo" });

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
        const currentCtx = addSpanParentToBaggage(spanB);
        const headers: Record<string, string> = {};
        propagation.inject(currentCtx, headers);

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
