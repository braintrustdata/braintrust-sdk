import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BraintrustSpanProcessor, setupOtelCompat } from "@braintrust/otel";
import { runCustomOtelExample } from "../common/custom_otel_example_common";

// Setup context manager to group span
const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// Initialize Braintrust OpenTelemetry
setupOtelCompat();

const braintrustProcessor = new BraintrustSpanProcessor({
  parent: "project_name:otel-v2-examples",
  filterAISpans: true,
});

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "custom-braintrust-service",
  }),
  spanProcessors: [braintrustProcessor],
});

trace.setGlobalTracerProvider(provider);

async function main() {
  await runCustomOtelExample(provider);
}

main().catch(console.error);
