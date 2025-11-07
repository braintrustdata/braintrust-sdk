import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { MastraExporter } from "../exporter";
import { Eval } from "../../../framework";
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
      assistant: new Agent({
        name: "Assistant",
        instructions: "Be concise.",
        model: openai("gpt-4o-mini"),
      }),
    },
    observability: {
      configs: {
        braintrust: {
          serviceName: "eval-demo",
          exporters: [exporter],
        },
      },
    },
  });

  await Eval("mastra-demo", {
    data: () => [
      { input: "What is the capital of France?", expected: "Paris" },
      { input: "What is 2+2?", expected: "4" },
    ],
    task: async (input: string) => {
      const agent = mastra.getAgent("assistant");
      return (await agent.generate(input)).text;
    },
    scores: [
      (args: any) => ({
        name: "contains_answer",
        score: String(args.output).toLowerCase().includes(String(args.expected).toLowerCase()) ? 1 : 0,
      }),
    ],
  });
}

main().catch(console.error);
