import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

export function makeRequest(tracer: ReturnType<typeof trace.getTracer>) {
  return tracer.startActiveSpan("nodesdk.example", async (rootSpan) => {
    rootSpan.setAttributes({
      "user.request": "openai_chat",
      "request.timestamp": new Date().toISOString(),
    });

    tracer.startActiveSpan("gen_ai.chat.completions", async (aiSpan) => {
      aiSpan.setAttributes({
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat.completions",
      });
      aiSpan.end();
    });

    tracer.startActiveSpan("a_non_llm_span", async (span) => {
      span.end();
    });

    rootSpan.end();
  });
}

export async function runNodesdkExample(
  sdk: NodeSDK,
  projectName: string,
  withBraintrustLogger: boolean = false,
) {
  const tracer = trace.getTracer("my-service", "1.0.0");

  if (withBraintrustLogger) {
    const { initLogger, login } = await import("braintrust");
    await login();
    const logger = initLogger({ projectName });

    let spanLink: string | undefined;
    await logger.traced(async (rootSpan) => {
      spanLink = rootSpan.link();
      // Create OpenTelemetry spans within the Braintrust span context
      await makeRequest(tracer);
    });

    // Wait a moment for spans to be processed and sent
    await logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(
      "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
    );
    if (spanLink) {
      console.log(`\nView trace: ${spanLink}`);
    }
  } else {
    await makeRequest(tracer);
    // Wait a moment for spans to be processed and sent
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log(
      "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
    );
  }

  await sdk.shutdown();
}
