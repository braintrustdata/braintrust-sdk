import { Eval } from "npm:braintrust";

// Top-level await - native Deno feature
const config = await Promise.resolve({ prefix: "Result: " });

const exactMatch = ({
  output,
  expected,
}: {
  output: string;
  expected?: string;
}) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-deno", {
  experimentName: "Top-Level Await Test",
  data: () => [{ input: "test", expected: config.prefix + "test" }],
  task: async (input: string) => config.prefix + input,
  scores: [exactMatch],
});
