import { Worker, NativeConnection } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import { AiSdkPlugin } from "@temporalio/ai-sdk";
import { openai } from "@ai-sdk/openai";
import * as activities from "./activities.js";

const TASK_QUEUE = "ai-sdk";

async function main() {
  braintrust.initLogger({ projectName: "temporal-example" });

  const connection = await NativeConnection.connect({
    address: "localhost:7233",
  });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    // Two plugins working together:
    // 1. AiSdkPlugin makes AI SDK calls deterministic for Temporal workflows
    // 2. BraintrustTemporalPlugin traces Temporal workflows and activities
    // For full LLM tracing of ai-sdk calls use wrapAISDK
    plugins: [
      new AiSdkPlugin({
        modelProvider: openai,
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
