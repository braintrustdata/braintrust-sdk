/**
 * This example demonstrates how to use BraintrustSpanProcessor with OpenTelemetry v1.x when filtering AI spans.
 */
import {
  BasicTracerProvider,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BraintrustSpanProcessor, setupOtelCompat } from "@braintrust/otel";
import { runCustomOtelExample } from "../common/custom_otel_example_common";

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// Initialize Braintrust OpenTelemetry
setupOtelCompat();

const provider = new BasicTracerProvider({
  resource: new Resource({
    "service.name": "custom-braintrust-service",
  }),
});
(provider as any).addSpanProcessor(
  // Add Braintrust span processor with filtering enabled
  new BraintrustSpanProcessor({
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }) as unknown as SpanProcessor,
);

trace.setGlobalTracerProvider(provider); // sets the global tracer provider

async function main() {
  await runCustomOtelExample(provider);
}

main().catch(console.error);
