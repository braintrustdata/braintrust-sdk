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
  BraintrustExporter,
} from "../../dist/index.js";

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
  await register();
}

async function register() {
  // Dynamically import ESM-only @vercel/otel module
  const { registerOTel } = await import("@vercel/otel");
  registerOTel({
    serviceName: "my-braintrust-app",
    traceExporter: new BraintrustExporter({
      filterAISpans: true,
      parent: `project_name:${process.env.PROJECT_NAME}`,
    }),
  });
}

main().catch(console.error);
