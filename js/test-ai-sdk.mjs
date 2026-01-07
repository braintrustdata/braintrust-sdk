#!/usr/bin/env node
/**
 * Test Vercel AI SDK auto-instrumentation
 * Run with: BRAINTRUST_AUTO_INSTRUMENT=1 BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import ./dist/auto-instrument/register.mjs test-ai-sdk.mjs
 */

console.log("\n========================================");
console.log("Testing AI SDK Auto-Instrumentation");
console.log("========================================\n");

console.log("[Test] Importing AI SDK...");
import * as ai from "ai";

console.log("[Test] Checking if AI SDK module is wrapped...");

// Check if wrapped
const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.ai-sdk");
const isWrapped = ai[WRAPPED_SYMBOL];

console.log("\n========================================");
if (isWrapped) {
  console.log("✅ SUCCESS: AI SDK module is wrapped!");
  console.log(
    "  Available functions:",
    Object.keys(ai)
      .filter((k) => typeof ai[k] === "function")
      .slice(0, 5)
      .join(", "),
  );
  console.log("========================================\n");
  process.exit(0);
} else {
  console.log("❌ FAIL: AI SDK module is NOT wrapped");
  console.log("  Debug: Check if hooks are intercepting imports");
  console.log("  Module keys:", Object.keys(ai).slice(0, 10).join(", "));
  console.log("========================================\n");
  process.exit(1);
}
