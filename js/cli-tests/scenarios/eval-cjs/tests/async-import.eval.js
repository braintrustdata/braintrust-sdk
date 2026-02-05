const { Eval } = require("braintrust");

// Dynamic import - works in async functions even in CJS
const getConfig = async () => {
  const { default: asyncConfig } = await import("./helper.js");
  return asyncConfig;
};

const exactMatch = ({ output, expected }) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-cjs", {
  experimentName: "Async Import Test",
  data: async () => {
    const config = await getConfig();
    return [{ input: "test", expected: config.prefix + "test" }];
  },
  task: async (input) => {
    const config = await getConfig();
    return config.prefix + input;
  },
  scores: [exactMatch],
});
