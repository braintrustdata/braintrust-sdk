import { Eval } from "braintrust";

// Dynamic import in TypeScript CJS
// Tests await import() inside async functions
const getConfig = async () => {
  const { default: asyncConfig } = await import("./helper.js");
  return asyncConfig;
};

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
  experimentName: "TypeScript CJS Async Import",
  data: async () => {
    const config = await getConfig();
    return [{ input: "test", expected: config.prefix + "test" }];
  },
  task: async (input: string) => {
    const config = await getConfig();
    return config.prefix + input;
  },
  scores: [exactMatch],
});
