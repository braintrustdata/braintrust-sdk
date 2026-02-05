import { Eval } from "braintrust";

const exactMatch = ({ output, expected }) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-esm", {
  experimentName: "Basic Test",
  data: () => [{ input: "test", expected: "test" }],
  task: async (input) => input,
  scores: [exactMatch],
});
