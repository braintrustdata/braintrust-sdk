/**
 * Minimal OpenAI Agents SDK integration example with Braintrust tracing
 *
 * Requirements:
 * - OPENAI_API_KEY environment variable
 * - @openai/agents package: npm install @openai/agents 'zod@<=3.25.67'
 *
 * Usage: npm run build && node examples/openai-agents-example.js
 */

import {
  Agent,
  run,
  addTraceProcessor,
  setTracingDisabled,
} from "@openai/agents";
import { initLogger, BraintrustTracingProcessor } from "braintrust";

async function main() {
  // Initialize Braintrust logging
  const logger = initLogger({
    projectName: "openai-agents-example",
    projectId: "oae",
  });

  // Set up tracing
  const processor = new BraintrustTracingProcessor(logger);
  setTracingDisabled(false);
  addTraceProcessor(processor);

  try {
    // Create a simple agent
    const agent = new Agent({
      name: "Assistant",
      model: "gpt-4o-mini",
      instructions: "You are a helpful assistant. Be concise.",
    });

    // Run the agent - this will be automatically traced
    const result = await run(agent, "What is 2+2?");

    console.log("Result:", result.finalOutput);
    console.log("Check your Braintrust project for the trace!");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    // Clean up
    processor.shutdown();
    logger.flush();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };
