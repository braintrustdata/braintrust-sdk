#!/usr/bin/env node
/**
 * Test that only uses environment variable + --import flag
 * Run with: BRAINTRUST_AUTO_INSTRUMENT=1 BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import ./dist/register.mjs test-register-only.mjs
 */

console.log("\n========================================");
console.log("Testing Auto-Instrumentation (Register Only)");
console.log("========================================\n");

console.log("[Test] Importing OpenAI SDK...");
import OpenAI from "openai";

console.log("[Test] Creating OpenAI client...");
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "test-key-not-real",
});

// Check if wrapped
const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.openai");
const isWrapped = client[WRAPPED_SYMBOL];

console.log("\n========================================");
if (isWrapped) {
  console.log("✅ SUCCESS: OpenAI client is wrapped!");
  console.log("========================================\n");
  process.exit(0);
} else {
  console.log("❌ FAIL: OpenAI client is NOT wrapped");
  console.log("  Debug: Check if hooks are intercepting imports");
  console.log("========================================\n");
  process.exit(1);
}
