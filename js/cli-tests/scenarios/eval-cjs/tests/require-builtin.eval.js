// Pure JavaScript CommonJS with Node.js built-ins
const { Eval } = require("braintrust");
const path = require("path");
const os = require("os");

const exactMatch = ({ output, expected }) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

Eval("test-cli-eval-cjs", {
  experimentName: "Require Built-in Test",
  data: () => [
    {
      input: ["folder", "file.txt"],
      expected: path.join("folder", "file.txt"),
    },
    {
      input: "platform",
      expected: os.platform(),
    },
  ],
  task: async (input) => {
    if (Array.isArray(input)) {
      return path.join(...input);
    } else {
      return os.platform();
    }
  },
  scores: [exactMatch],
});
