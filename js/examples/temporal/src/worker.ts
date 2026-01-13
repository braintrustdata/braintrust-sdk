import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities";

const TASK_QUEUE = "braintrust-example-task-queue";

async function main() {
  const connection = await NativeConnection.connect({
    address: "localhost:7233",
  });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities,
  });

  console.log(`Worker started on task queue: ${TASK_QUEUE}`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
