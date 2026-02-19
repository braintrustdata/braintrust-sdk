import { Connection, Client } from "@temporalio/client";
import { haikuAgent, toolsAgent } from "./workflows.js";
import { nanoid } from "nanoid";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";
import * as braintrust from "braintrust";

async function run() {
  const args = process.argv;
  const workflow = args[2] ?? "haiku";

  braintrust.initLogger({
    projectName: "temporal-example",
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  const connection = await Connection.connect({
    address: "localhost:7233",
  });

  const client = new Client({
    connection,
    namespace: "default",
    plugins: [new BraintrustTemporalPlugin()],
  });

  let handle;
  switch (workflow) {
    case "tools":
      handle = await client.workflow.start(toolsAgent, {
        taskQueue: "ai-sdk",
        args: ["What is the weather in Tokyo?"],
        workflowId: "workflow-" + nanoid(),
      });
      break;
    case "haiku":
      handle = await client.workflow.start(haikuAgent, {
        taskQueue: "ai-sdk",
        args: ["Temporal"],
        workflowId: "workflow-" + nanoid(),
      });
      break;
    default:
      throw new Error("Unknown workflow type: " + workflow);
  }

  const result = await handle.result();
  console.log(result);

  await braintrust.flush();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
