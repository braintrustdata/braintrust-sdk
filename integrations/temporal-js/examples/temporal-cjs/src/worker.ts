import { Worker, NativeConnection } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import * as activities from "./activities";

const TASK_QUEUE = "braintrust-example-task-queue";

async function main() {
  braintrust.initLogger({ projectName: "temporal-example" });

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

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities,
    plugins: [new BraintrustTemporalPlugin()],
  });

  console.log(`Worker started on task queue: ${TASK_QUEUE}`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
