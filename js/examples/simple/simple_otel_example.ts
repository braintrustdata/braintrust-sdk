import { initLogger, BraintrustSpanProcessor } from "braintrust";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";

async function main() {
  const logger = initLogger({ projectName: "otel-simple-example" });

  const sdk = new NodeSDK({
    serviceName: "simple-service",
    spanProcessor: new BraintrustSpanProcessor({
      parent: "project_name:otel-examples",
      filterAISpans: true,
    }),
  });

  await sdk.start();

  const tracer = trace.getTracer("simple-service", "1.0.0");

  const span = logger.startSpan({ name: "logger.simple" });
  span.log({
    message: "Logging a Braintrust span before OTEL spans",
    metadata: { example: "simple" },
  });
  span.end();

  await tracer.startActiveSpan("otel.simple", async (rootSpan) => {
    rootSpan.setAttribute("example", "simple");
    tracer.startActiveSpan("otel.simple.child", (childSpan) => {
      childSpan.setAttribute("child", true);
      childSpan.end();
    });
    rootSpan.end();
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await sdk.shutdown();
  console.log(
    "Finished simple OTEL example. Check https://braintrust.dev for exported spans.",
  );
}

main().catch((error) => {
  console.error("Simple OTEL example failed:", error);
  process.exitCode = 1;
});
