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
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import {
  BraintrustSpanProcessor,
  setupOtelCompat,
  contextFromSpanExport,
  addSpanParentToBaggage,
  parentFromHeaders,
} from "@braintrust/otel";
import { initLogger, login } from "braintrust";
import { runDistributedTracingExample } from "../common/distributed_tracing_common";

const { trace, context } = api;

setupOtelCompat();

async function main() {
  const braintrustProcessor = new BraintrustSpanProcessor();

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "service-b",
    }),
    spanProcessors: [braintrustProcessor],
  });
  trace.setGlobalTracerProvider(provider);

  // Setup context manager
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  await runDistributedTracingExample(
    provider,
    "otel-v2-examples",
    api,
    { contextFromSpanExport, addSpanParentToBaggage, parentFromHeaders },
    { initLogger, login },
  );
}

main().catch(console.error);
