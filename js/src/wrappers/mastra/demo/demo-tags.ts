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
        instructions: "Be concise.",
        model: openai("gpt-4o-mini"),
      }),
    },
    observability: {
      configs: {
        braintrust: {
          serviceName: "tags-demo",
          exporters: [exporter],
        },
      },
    },
  });

  for (const env of ["production", "staging", "development"]) {
    await logger.traced(async (span) => {
      span.log({ tags: [`environment:${env}`], metadata: { environment: env } });
      const agent = mastra.getAgent("demo");
      const response = await agent.generate("Say hi");
      console.log(`${env}: ${response.text}`);
    });
  }
}

main().catch(console.error);
