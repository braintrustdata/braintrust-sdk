// Pure JavaScript CommonJS with module.exports pattern
const { Eval } = require("braintrust");

// Classic CJS module pattern
const helper = {
  prefix: "Result: ",
  suffix: "!",
};

module.exports = { helper };

const exactMatch = ({ output, expected }) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-cjs", {
  experimentName: "module.exports Test",
  data: () => [
    {
      input: "test",
      expected: helper.prefix + "test" + helper.suffix,
    },
  ],
  task: async (input) => {
    return helper.prefix + input + helper.suffix;
  },
  scores: [exactMatch],
});
