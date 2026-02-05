// Pure JavaScript CommonJS with __dirname and __filename
const { Eval } = require("braintrust");

// CJS-only globals
const currentDir = __dirname;
const currentFile = __filename;

const containsMatch = ({ output, expected }) => ({
  name: "contains_match",
  score: expected && output.includes(expected) ? 1 : 0,
});

Eval("test-cli-eval-cjs", {
  experimentName: "__dirname/__filename Test",
  data: () => [
    {
      input: "dirname",
      expected: "eval-cjs",
    },
    {
      input: "filename",
      expected: ".eval.js",
    },
  ],
  task: async (input) => {
    if (input === "dirname") {
      return currentDir;
    } else {
      return currentFile;
    }
  },
  scores: [containsMatch],
});
