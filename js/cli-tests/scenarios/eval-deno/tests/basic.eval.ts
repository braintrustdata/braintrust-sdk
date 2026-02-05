import { Eval } from "npm:braintrust";

// Deno using npm: imports (from extracted tarball in node_modules/)
// Tests: deno run --allow-all basic.eval.ts

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
  experimentName: "Basic Deno Test",
  data: () => [{ input: "test", expected: "test" }],
  task: async (input: string) => input,
  scores: [exactMatch],
});
