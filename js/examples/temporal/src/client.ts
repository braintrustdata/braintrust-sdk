import { Client, Connection } from "@temporalio/client";
import { v4 as uuid } from "uuid";
import * as braintrust from "braintrust";
import { createBraintrustClientInterceptor } from "braintrust";
import { simpleWorkflow } from "./workflows";
import type { TaskInput } from "./activities";

const TASK_QUEUE = "braintrust-example-task-queue";

async function main() {
  braintrust.initLogger({ projectName: "temporal-example" });

  const connection = await Connection.connect({
    address: "localhost:7233",
  });

  const client = new Client({
    connection,
    namespace: "default",
    interceptors: {
      workflow: [createBraintrustClientInterceptor()],
    },
  });

  const inputData: TaskInput = { value: 5 };
  const workflowId = `simple-workflow-${uuid().slice(0, 8)}`;

  console.log(`Starting workflow with value: ${inputData.value}`);
  console.log(`Workflow ID: ${workflowId}`);

  // Wrap in a Braintrust span
  await braintrust.traced(
    async (span) => {
      const handle = await client.workflow.start(simpleWorkflow, {
        args: [inputData],
        taskQueue: TASK_QUEUE,
        workflowId,
      });

      const result = await handle.result();
      span.log({ output: result });
      console.log(`\nResult: ${result}`);
      console.log(`\nView trace: ${span.link()}`);
      return result;
    },
    { name: "temporal.client.simpleWorkflow" },
  );

  await braintrust.flush();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
