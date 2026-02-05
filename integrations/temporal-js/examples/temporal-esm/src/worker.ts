import { Worker, NativeConnection } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import * as activities from "./activities";

const TASK_QUEUE = "braintrust-example-task-queue";

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
    plugins: [new BraintrustTemporalPlugin()],
  });

  console.log(`Worker started on task queue: ${TASK_QUEUE}`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
