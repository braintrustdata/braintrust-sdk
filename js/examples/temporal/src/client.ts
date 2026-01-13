import { Client, Connection } from "@temporalio/client";
import { v4 as uuid } from "uuid";
import { simpleWorkflow } from "./workflows";
import type { TaskInput } from "./activities";

const TASK_QUEUE = "braintrust-example-task-queue";

async function main() {
  const connection = await Connection.connect({
    address: "localhost:7233",
  });

  const client = new Client({
    connection,
    namespace: "default",
  });

  const inputData: TaskInput = { value: 5 };
  const workflowId = `simple-workflow-${uuid().slice(0, 8)}`;

  console.log(`Starting workflow with value: ${inputData.value}`);
  console.log(`Workflow ID: ${workflowId}`);

  const handle = await client.workflow.start(simpleWorkflow, {
    args: [inputData],
    taskQueue: TASK_QUEUE,
    workflowId,
  });

  const result = await handle.result();
  console.log(`\nResult: ${result}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
