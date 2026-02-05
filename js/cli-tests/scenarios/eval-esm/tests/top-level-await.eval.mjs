import { Eval } from "braintrust";

const config = await Promise.resolve({ prefix: "Result: " });

const exactMatch = ({ output, expected }) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-esm", {
  experimentName: "Top-Level Await Test",
  data: () => [{ input: "test", expected: "Result: test" }],
  task: async (input) => config.prefix + input,
  scores: [exactMatch],
});
