#!/usr/bin/env node
/**
 * Test OpenTelemetry auto-detection and integration
 * Run with: BRAINTRUST_AUTO_INSTRUMENT=1 BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import @braintrust/auto-instrument/register test-otel-integration.mjs
 * Or from package: BRAINTRUST_AUTO_INSTRUMENT=1 BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import ./dist/register.mjs test-otel-integration.mjs
 */

console.log("\n========================================");
console.log("Testing OpenTelemetry Auto-Detection");
console.log("========================================\n");

// Check if @braintrust/otel registered itself
const setupOtelCompat = globalThis.__braintrust_setup_otel_compat;

console.log("[Test] Checking if @braintrust/otel is installed...");
const isOtelInstalled = typeof setupOtelCompat === "function";

if (isOtelInstalled) {
  console.log("✅ @braintrust/otel is installed and registered");

  // Check if OTel compat was setup
  const contextManager = globalThis.BRAINTRUST_CONTEXT_MANAGER;
  const idGenerator = globalThis.BRAINTRUST_ID_GENERATOR;
  const spanComponent = globalThis.BRAINTRUST_SPAN_COMPONENT;

  const isSetup =
    contextManager !== undefined &&
    idGenerator !== undefined &&
    spanComponent !== undefined;

  console.log("\n[Test] Checking if setupOtelCompat() was called...");

  console.log("\n========================================");
  if (isSetup) {
    console.log("✅ SUCCESS: OpenTelemetry compatibility is enabled!");
    console.log("  BRAINTRUST_CONTEXT_MANAGER:", !!contextManager);
    console.log("  BRAINTRUST_ID_GENERATOR:", !!idGenerator);
    console.log("  BRAINTRUST_SPAN_COMPONENT:", !!spanComponent);
    console.log("========================================\n");
    process.exit(0);
  } else {
    console.log("⚠️  WARNING: @braintrust/otel is installed but not setup");
    console.log("  This might indicate auto-detection didn't run");
    console.log("  BRAINTRUST_CONTEXT_MANAGER:", !!contextManager);
    console.log("  BRAINTRUST_ID_GENERATOR:", !!idGenerator);
    console.log("  BRAINTRUST_SPAN_COMPONENT:", !!spanComponent);
    console.log("========================================\n");
    process.exit(1);
  }
} else {
  console.log("ℹ️  @braintrust/otel is not installed (optional)");
  console.log("  This is expected if you haven't installed @braintrust/otel");
  console.log("  Auto-instrumentation will work without OpenTelemetry");
  console.log("\n========================================");
  console.log("✅ SUCCESS: Auto-detection working correctly!");
  console.log("========================================\n");
  process.exit(0);
}
