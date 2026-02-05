import { Eval } from "braintrust";

// Top-level await - ESM-only feature
// This proves the CLI can handle async module evaluation
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

Eval("test-cli-eval-ts-esm", {
  experimentName: "Top-Level Await Test",
  data: () => [{ input: "test", expected: "Result: test" }],
  task: async (input: string) => config.prefix + input,
  scores: [exactMatch],
});
