import { EvaluatorDef, login } from "braintrust";
import { z } from "zod/v3";
import { runDevServer } from "../dev/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e: EvaluatorDef<any, any, any, any, any> = {
  // projectName: "braintrust-sdk-test",
  data: [
    { input: "What is 2 + 2?", expected: "4" },
    { input: "What is the capital of France?", expected: "Paris" },
    { input: "What color is the sky?", expected: "Blue" },
  ],
  task: async (input) => {
    // Simple hardcoded responses based on input
    const question =
      typeof input === "string" ? input : input?.input || String(input);
    if (question.includes("2 + 2")) return "4";
    if (question.includes("capital") && question.includes("France"))
      return "Paris";
    if (question.includes("color") && question.includes("sky")) return "Blue";
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
  await login();

  runDevServer([e], {
    host: "0.0.0.0",
    port: 8011,
  });
}

main();
