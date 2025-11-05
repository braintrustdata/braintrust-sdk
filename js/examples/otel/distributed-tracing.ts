#!/usr/bin/env tsx
/**
 * Minimal example: Distributed Tracing BT → OTEL → BT
 *
 * Run with: BRAINTRUST_OTEL_COMPAT=true tsx examples/otel/distributed-tracing.ts
 */

import * as api from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  initLogger,
  login,
  otel,
  BraintrustSpanProcessor,
} from "../../dist/index.js";

const { trace, context, propagation } = api;

async function main() {
  // Setup OTEL
  const braintrustProcessor = await BraintrustSpanProcessor.create({
    parent: "project_name:otel_examples",
    filterAISpans: true,
  });
  const provider = new BasicTracerProvider({
    spanProcessors: [braintrustProcessor],
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
    const ctx = await otel.contextFromSpanExport(exported);
    if (ctx) {
      await context.with(ctx, async () => {
        await tracer.startActiveSpan("service_b", async (spanB) => {
          // Export to Service C
          const currentCtx = await otel.addSpanParentToBaggage(spanB);
          if (currentCtx) {
            const headers: Record<string, string> = {};
            propagation.inject(currentCtx, headers);

            // Service C (Braintrust)
            const parent = await otel.parentFromHeaders(headers);
            if (parent) {
              await logger.traced(
                async (spanC) => {
                  spanC.log({ input: "from service B" });
                },
                { name: "service_c", parent },
              );
            }

            spanB.end();
          }
        });
      });
    }
  });

  await logger.flush();
  await provider.forceFlush();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(`\nView trace: ${spanLink}`);
}

main().catch(console.error);
