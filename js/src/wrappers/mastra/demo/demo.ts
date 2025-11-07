import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { MastraExporter } from "../exporter";
import { initLogger } from "../../../logger";
import { configureNode } from "../../../node";

configureNode();

async function main() {
  const logger = initLogger({
    projectName: "mastra-demo",
    apiKey: process.env.BRAINTRUST_API_KEY,
    appUrl: process.env.BRAINTRUST_API_URL,
  });

  const exporter = new MastraExporter({
    logger,
  });

  const mastra = new Mastra({
    agents: {
      demo: new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: openai("gpt-4o"),
      }),
    },
    observability: {
      configs: {
        braintrust: {
          serviceName: "demo",
          exporters: [exporter],
        },
      },
    },
  });

  const agent = mastra.getAgent("demo");
  const response = await agent.generate("What is 2+2?");
  console.log(response.text);
}

main().catch(console.error);
