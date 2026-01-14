#!/usr/bin/env node
/**
 * Test Vercel AI SDK auto-instrumentation
 * Run with: node --import @braintrust/auto-instrument/register test-ai-sdk.mjs
 * Or from package: node --import ./dist/register.mjs test-ai-sdk.mjs
 * Optional debug: BRAINTRUST_AUTO_INSTRUMENT_DEBUG=1 node --import ./dist/register.mjs test-ai-sdk.mjs
 */

console.log("\n========================================");
console.log("Testing AI SDK Auto-Instrumentation");
console.log("========================================\n");

console.log("[Test] Importing AI SDK...");
import * as ai from "ai";

console.log("[Test] Checking if AI SDK module is wrapped...");

// Check if wrapped by verifying that key functions exist
// Note: AI SDK uses in-place wrapping, not Symbol-based detection
const hasGenerateText =
  "generateText" in ai && typeof ai.generateText === "function";
const hasStreamText = "streamText" in ai && typeof ai.streamText === "function";
const hasGenerateObject =
  "generateObject" in ai && typeof ai.generateObject === "function";

const allFunctionsExist = hasGenerateText && hasStreamText && hasGenerateObject;

console.log("\n========================================");
if (allFunctionsExist) {
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
  console.log("❌ FAIL: AI SDK module is NOT wrapped properly");
  console.log("  Debug: Check if hooks are intercepting imports");
  console.log("  Module keys:", Object.keys(ai).slice(0, 10).join(", "));
  console.log("  hasGenerateText:", hasGenerateText);
  console.log("  hasStreamText:", hasStreamText);
  console.log("  hasGenerateObject:", hasGenerateObject);
  console.log("========================================\n");
  process.exit(1);
}
