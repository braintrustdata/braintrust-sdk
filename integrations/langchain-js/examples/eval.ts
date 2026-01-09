/**
 * Simple Usage Example - JavaScript/TypeScript
 *
 * This example demonstrates simple usage of BraintrustCallbackHandler
 * where the handler is created inside the task without explicitly
 * passing the logger parameter.
 *
 * This works because the handler captures the current span context
 * at construction time when created inside a Braintrust task.
 *
 * Run with:
 *   pnpm dlx tsx examples/simple-usage.ts
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { Eval } from "braintrust";
import { BraintrustCallbackHandler } from "../src/BraintrustCallbackHandler";

async function main() {
  console.log("Starting simple usage example...\n");

  const result = await Eval("LangChain Simple Example", {
    data: () => [
      { input: "Tell me a short joke about programming", expected: "funny" },
      { input: "What's 15 + 27?", expected: "42" },
    ],

    task: async (input) => {
      console.log(`Processing: "${input}"`);

      // ✅ Create handler without explicit logger
      // This works because we're inside a Braintrust task,
      // so the handler captures the task span automatically
      const handler = new BraintrustCallbackHandler();

      const prompt = ChatPromptTemplate.fromTemplate("{question}");

      const model = new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0.7,
      });

      const chain = prompt.pipe(model);

      const message = await chain.invoke(
        { question: input },
        { callbacks: [handler] },
      );

      return message.content;
    },

    scores: [
      () => ({
        name: "completed",
        score: 1,
      }),
    ],
  });

  console.log("\n✅ Eval completed!");
  console.log(`Results: ${result.results.length} tasks processed`);
  console.log(
    `Experiment URL: ${result.summary.experimentUrl || "N/A (local run)"}`,
  );

  // Show results
  result.results.forEach((r, i) => {
    console.log(`\nTask ${i + 1}:`);
    console.log(`  Input: ${r.input}`);
    console.log(`  Output: ${String(r.output).substring(0, 100)}...`);
  });
}

// Run the example
main().catch(console.error);
