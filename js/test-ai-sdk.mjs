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

// Check if wrapped by verifying that key functions exist and have been modified
// We can't use a Symbol because import-in-the-middle intercepts property access
const hasGenerateText =
  "generateText" in ai && typeof ai.generateText === "function";
const hasStreamText = "streamText" in ai && typeof ai.streamText === "function";
const hasGenerateObject =
  "generateObject" in ai && typeof ai.generateObject === "function";

// Check if functions have the wrapper function name (wrapped functions have different names)
const generateTextName = ai.generateText?.name || "";
const isWrapped =
  hasGenerateText &&
  hasStreamText &&
  hasGenerateObject &&
  (generateTextName === "generateText" ||
    generateTextName === "wrapper" ||
    generateTextName === "");

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
  console.log(`  generateText function name: "${generateTextName}"`);
  console.log("========================================\n");
  process.exit(0);
} else {
  console.log("❌ FAIL: AI SDK module is NOT wrapped");
  console.log("  Debug: Check if hooks are intercepting imports");
  console.log("  Module keys:", Object.keys(ai).slice(0, 10).join(", "));
  console.log("  hasGenerateText:", hasGenerateText);
  console.log("  hasStreamText:", hasStreamText);
  console.log("  hasGenerateObject:", hasGenerateObject);
  console.log(`  generateText name: "${generateTextName}"`);
  console.log("========================================\n");
  process.exit(1);
}
