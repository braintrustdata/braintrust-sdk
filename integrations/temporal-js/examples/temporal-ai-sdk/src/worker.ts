import { Worker, NativeConnection } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import * as activities from "./activities.js";

const TASK_QUEUE = "ai-sdk";

async function main() {
  braintrust.initLogger({
    projectName: "temporal-example",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

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

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    plugins: [new BraintrustTemporalPlugin()],
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
