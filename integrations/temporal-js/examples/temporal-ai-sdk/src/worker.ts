import { Worker, NativeConnection } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { wrapAISDKProvider } from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import { AiSdkPlugin } from "@temporalio/ai-sdk";
import { openai } from "@ai-sdk/openai";
import * as activities from "./activities.js";

const TASK_QUEUE = "ai-sdk";

async function main() {
  braintrust.initLogger({
    projectName: "temporal-example",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  // Retry connection in case server is still starting
  let connection;
  for (let i = 0; i < 10; i++) {
    try {
      connection = await NativeConnection.connect({
        address: "localhost:7233",
      });
      break;
    } catch (err) {
      if (i === 9) throw err;
      console.log(`Waiting for Temporal server... (${i + 1}/10)`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Wrap the OpenAI provider to add Braintrust tracing
  // This enables LLM observability for Pattern 2 workflows (using temporalProvider)
  const tracedOpenAI = wrapAISDKProvider(openai);

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    // Three-layer integration:
    // 1. AiSdkPlugin makes AI SDK calls deterministic for Temporal workflows
    // 2. wrapAISDKProvider adds LLM tracing (prompts, tokens, completions)
    // 3. BraintrustTemporalPlugin traces Temporal workflows and activities
    plugins: [
      new AiSdkPlugin({
        modelProvider: tracedOpenAI, // Use traced provider instead of raw openai
      }),
      new BraintrustTemporalPlugin(),
    ],
  });

  console.log(`Worker started on task queue: ${TASK_QUEUE}`);
  await worker.run();
}

main().catch((err) => {
  if (err instanceof Error) {
    console.error(err.stack || err.message || err);
  } else {
    console.error("Uncaught (non-Error) thrown:", err);
  }
  process.exit(1);
});
