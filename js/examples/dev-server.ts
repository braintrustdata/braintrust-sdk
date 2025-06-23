import { EvaluatorDef, login } from "braintrust";
import { z } from "zod";
import { runDevServer } from "braintrust/dev";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e: EvaluatorDef<any, any, any, any, any> = {
  data: [
    { input: "What is 2 + 2?", expected: "4" },
    { input: "What is the capital of France?", expected: "Paris" },
    { input: "What color is the sky?", expected: "Blue" },
  ],
  task: async (input) => {
    // Simple hardcoded responses based on input
    if (input.includes("2 + 2")) return "4";
    if (input.includes("capital") && input.includes("France")) return "Paris";
    if (input.includes("color") && input.includes("sky")) return "Blue";
    return "I don't know the answer to that question.";
  },
  scores: [],
  parameters: {
    simple_param: z
      .string()
      .default("default value")
      .describe("A simple parameter for testing"),
  },
  evalName: "parameters-server",
};

async function main() {
  console.log("here");
  await login();
  console.log("asdf");

  runDevServer([e], {
    host: "0.0.0.0",
    port: 8011,
  });
}

main();
