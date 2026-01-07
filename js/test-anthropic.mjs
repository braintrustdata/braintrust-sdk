#!/usr/bin/env node
/**
 * Test Anthropic SDK auto-instrumentation
 * Run with: BRAINTRUST_AUTO_INSTRUMENT=1 BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import ./dist/auto-instrument/register.mjs test-anthropic.mjs
 */

console.log("\n========================================");
console.log("Testing Anthropic Auto-Instrumentation");
console.log("========================================\n");

console.log("[Test] Importing Anthropic SDK...");
import Anthropic from "@anthropic-ai/sdk";

console.log("[Test] Creating Anthropic client...");
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "test-key-not-real",
});

// Check if wrapped
const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.anthropic");
const isWrapped = client[WRAPPED_SYMBOL];

console.log("\n========================================");
if (isWrapped) {
  console.log("✅ SUCCESS: Anthropic client is wrapped!");
  console.log("========================================\n");
  process.exit(0);
} else {
  console.log("❌ FAIL: Anthropic client is NOT wrapped");
  console.log("  Debug: Check if hooks are intercepting imports");
  console.log("========================================\n");
  process.exit(1);
}
