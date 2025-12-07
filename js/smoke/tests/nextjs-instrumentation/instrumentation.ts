/**
 * Next.js instrumentation file that sets up OpenTelemetry with Braintrust.
 *
 * This file is loaded by Next.js when the experimental.instrumentationHook
 * config option is enabled. It tests that @braintrust/otel works correctly
 * in a Next.js environment where the bundler performs static analysis of imports.
 */

import { registerOTel } from "@vercel/otel";

export async function register() {
  const { BraintrustExporter } = await import("@braintrust/otel");
  registerOTel({
    serviceName: "nextjs-instrumentation-test",
    traceExporter: new BraintrustExporter({
      parent: "project_name:nextjs-instrumentation-test",
      filterAISpans: true,
    }) as any,
  });
}
