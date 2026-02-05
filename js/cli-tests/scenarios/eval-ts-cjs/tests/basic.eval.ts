import { Eval } from "braintrust";

// TypeScript configured for CJS output
// Tests esbuild TypeScript → CJS compilation

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

Eval("test-cli-eval-ts-cjs", {
  experimentName: "Basic TypeScript CJS Test",
  data: () => [{ input: "test", expected: "test" }],
  task: async (input: string) => input,
  scores: [exactMatch],
});
