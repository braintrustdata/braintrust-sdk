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

Eval("test-cli-eval-bun", {
  experimentName: "Basic Test",
  data: () => [{ input: "test", expected: "test" }],
  task: async (input: string) => input,
  scores: [exactMatch],
});
