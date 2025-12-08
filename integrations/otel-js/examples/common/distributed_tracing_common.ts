import type { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type * as api from "@opentelemetry/api";

export async function runDistributedTracingExample(
  provider: BasicTracerProvider,
  projectName: string,
  otelApi: typeof import("@opentelemetry/api"),
  braintrustOtel: {
    contextFromSpanExport: typeof import("@braintrust/otel").contextFromSpanExport;
    addSpanParentToBaggage: typeof import("@braintrust/otel").addSpanParentToBaggage;
    parentFromHeaders: typeof import("@braintrust/otel").parentFromHeaders;
  },
  braintrust: {
    initLogger: typeof import("braintrust").initLogger;
    login: typeof import("braintrust").login;
  },
) {
  const { trace, context, propagation } = otelApi;
  const { contextFromSpanExport, addSpanParentToBaggage, parentFromHeaders } =
    braintrustOtel;
  const { initLogger, login } = braintrust;

  const tracer = trace.getTracer("service-b");

  await login();
  const logger = initLogger({ projectName });

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
