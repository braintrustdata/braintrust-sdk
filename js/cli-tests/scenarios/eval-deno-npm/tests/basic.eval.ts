// Deno-style TypeScript file
// User writes this targeting Deno, then tries: npx braintrust eval basic.eval.ts

import { Eval } from "braintrust";

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

Eval("test-cli-eval-deno-npm", {
  experimentName: "Basic Test",
  data: () => [{ input: "test", expected: "test" }],
  task: async (input: string) => input,
  scores: [exactMatch],
});
