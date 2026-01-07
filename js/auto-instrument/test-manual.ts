#!/usr/bin/env node
/**
 * Manual test script for auto-instrumentation
 *
 * Run with: node --import ./dist/register.mjs test-manual.ts
 * Or: BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node test-manual.ts
 */

// Setup auto-instrumentation BEFORE any SDK imports
import { setupAutoInstrumentation } from "./dist/index.mjs";

console.log("\n========================================");
console.log("Testing Braintrust Auto-Instrumentation");
console.log("========================================\n");

setupAutoInstrumentation({
  debug: true,
  include: ["openai"],
});

console.log("[Test] Auto-instrumentation setup complete\n");

// Now dynamically import OpenAI to test the hook
async function runTest() {
  try {
    console.log("[Test] Importing OpenAI SDK...");
    const OpenAIModule = await import("openai");
    const OpenAI = OpenAIModule.default;

    console.log("[Test] Creating OpenAI client...");
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "test-key-not-real",
    });

    // Check if wrapped
    const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.openai");
    const isWrapped = (client as any)[WRAPPED_SYMBOL];

    console.log("\n========================================");
    if (isWrapped) {
      console.log("✅ SUCCESS: OpenAI client is wrapped!");
      console.log("========================================\n");
      process.exit(0);
    } else {
      console.log("❌ FAIL: OpenAI client is NOT wrapped");
      console.log("========================================\n");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ ERROR during test:", error);
    console.log("========================================\n");
    process.exit(1);
  }
}

runTest();
