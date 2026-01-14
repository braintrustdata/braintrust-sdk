// Integration test for auto-instrumentation
// Run with: node --import @braintrust/auto-instrument/register test-integration.mjs

import OpenAI from "openai";

console.log("Testing auto-instrumentation...");

const client = new OpenAI({ apiKey: "test" });

// Check if wrapped
const wrapped = client[Symbol.for("braintrust.wrapped.openai")];
if (wrapped) {
  console.log("✅ OpenAI client is wrapped");
  process.exit(0);
} else {
  console.error("❌ OpenAI client is NOT wrapped");
  process.exit(1);
}
