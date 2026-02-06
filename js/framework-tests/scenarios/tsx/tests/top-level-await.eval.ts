import { Eval } from "braintrust";

// Top-level await - ESM-only feature
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

Eval("test-framework-tsx", {
  experimentName: "Top-Level Await Test",
  data: () => [{ input: "test", expected: "Result: test" }],
  task: async (input: string) => config.prefix + input,
  scores: [exactMatch],
});
