#!/usr/bin/env tsx
/**
 * Distributed Tracing Example: BT → OTEL → BT
 * 
 * This demonstrates the new @braintrust/otel pattern for distributed tracing:
 * 1. Service A creates a Braintrust span and exports it
 * 2. Service B imports it as OTEL context and creates OTEL spans
 * 3. Service C receives OTEL headers and creates Braintrust spans
 * 
 * Migration notes:
 *   - Import otel utilities from "@braintrust/otel" instead of "braintrust"
 *   - No need for BRAINTRUST_OTEL_COMPAT=true
 *   - Explicit dependencies make setup clearer
 */

import * as api from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { initLogger, login } from "braintrust";
import { otel, BraintrustSpanProcessor } from "@braintrust/otel";

const { trace, context, propagation } = api;

async function main() {
  // Setup OTEL
  const provider = new BasicTracerProvider({
    spanProcessors: [new BraintrustSpanProcessor()],
  });
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
    const ctx = otel.contextFromSpanExport(exported);
    await context.with(ctx, async () => {
      await tracer.startActiveSpan("service_b", async (spanB) => {
        // Export to Service C
        const currentCtx = otel.addSpanParentToBaggage(spanB);
        const headers: Record<string, string> = {};
        propagation.inject(currentCtx, headers);

        // Service C (Braintrust)
        const parent = otel.parentFromHeaders(headers);
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
