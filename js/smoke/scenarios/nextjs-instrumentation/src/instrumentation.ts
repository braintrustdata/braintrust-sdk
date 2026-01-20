/**
 * Next.js instrumentation file that sets up OpenTelemetry with Braintrust.
 *
 * This file is loaded by Next.js when the experimental.instrumentationHook
 * config option is enabled. It tests that:
 * 1. @braintrust/otel works correctly in Next.js
 * 2. Shared test package can be imported (webpack bundling verification)
 *
 * Note: The import statement below is the actual test - if webpack can't
 * resolve or bundle the shared test package, the build will fail.
 * Runtime testing happens in app/api/smoke-test/edge/route.ts and
 * app/api/smoke-test/node/route.ts instead.
 */

import { registerOTel } from "@vercel/otel";

// Import verification: webpack will fail the build if this import doesn't work
// This tests tree-shaking and module resolution
import {
  setupTestEnvironment,
  runBasicLoggingTests,
  runImportVerificationTests,
} from "../../../shared";

export async function register() {
  // Log that imports succeeded (build-time verification passed)
  console.log(
    "Next.js instrumentation: Shared test package imports successful",
  );
  console.log(
    "Build-time verification passed - webpack successfully bundled shared test package",
  );

  // Set up OpenTelemetry with Braintrust
  const { BraintrustExporter } = await import("@braintrust/otel");
  registerOTel({
    serviceName: "nextjs-instrumentation-test",
    traceExporter: new BraintrustExporter({
      parent: "project_name:nextjs-instrumentation-test",
      filterAISpans: true,
    }) as any,
  });

  console.log("Next.js instrumentation: OTEL setup complete");
}

// Prevent tree-shaking from removing the imported functions
// (They need to be referenced somewhere for webpack to include them)
if (process.env.NODE_ENV === "test") {
  // This code never runs in production, but ensures webpack includes the imports
  void setupTestEnvironment;
  void runBasicLoggingTests;
  void runImportVerificationTests;
}
