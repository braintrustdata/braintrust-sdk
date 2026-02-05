import { Eval } from "braintrust";

const currentUrl = import.meta.url;

const containsMatch = ({ output, expected }) => ({
  name: "contains_match",
  score: expected && output.includes(expected) ? 1 : 0,
});

Eval("test-cli-eval-esm", {
  experimentName: "import.meta.url Test",
  data: () => [
    {
      input: "url",
      expected: ".eval.mjs",
    },
  ],
  task: async (input) => {
    return currentUrl;
  },
  scores: [containsMatch],
});
