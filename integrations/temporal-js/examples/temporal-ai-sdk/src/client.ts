import { Connection, Client } from "@temporalio/client";
import { haikuAgent, haikuAgentTraced, toolsAgent } from "./workflows.js";
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

  const tracedResult = await braintrust.traced(
    async (span) => {
      // Start the workflow (client interceptor will propagate this span context)
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
        case "haiku-traced":
          handle = await client.workflow.start(haikuAgentTraced, {
            taskQueue: "ai-sdk",
            args: ["Temporal"],
            workflowId: "workflow-" + nanoid(),
          });
          break;
        default:
          throw new Error("Unknown workflow type: " + workflow);
      }

      // Wait for workflow result
      const result = await handle.result();
      span.log({ output: result });

      return result;
    },
    {
      name: `temporal.client.startWorkflow.${workflow}`,
      spanAttributes: { type: "task" },
      event: {
        metadata: {
          workflow_type: workflow,
        },
      },
    },
  );

  try {
    await braintrust.flush();
  } catch (err) {
    console.error("[DEBUG] Flush error:", err);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
