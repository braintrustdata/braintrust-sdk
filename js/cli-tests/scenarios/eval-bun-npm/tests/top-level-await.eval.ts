import { Eval } from "braintrust";

// Top-level await - Bun-style code
// User wrote this targeting Bun, then tries: npm run braintrust eval top-level-await.eval.ts
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

Eval("test-cli-eval-bun-npm", {
  experimentName: "Top-level Await Test",
  data: () => [{ input: "test", expected: config.prefix + "test" }],
  task: async (input: string) => config.prefix + input,
  scores: [exactMatch],
});
