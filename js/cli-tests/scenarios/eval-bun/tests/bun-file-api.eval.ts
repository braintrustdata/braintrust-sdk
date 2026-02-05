import { Eval } from "braintrust";

// Test Bun's file API - unique to Bun runtime
// Bun.file() and Bun.write() are much faster than Node.js fs

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

// Create a test file using Bun.write
const testFilePath = "./test-data.txt";
await Bun.write(testFilePath, "Hello from Bun!");

Eval("test-cli-eval-bun", {
  experimentName: "Bun File API Test",
  data: async () => {
    // Read file using Bun.file() - very fast!
    const file = Bun.file(testFilePath);
    const content = await file.text();

    return [
      {
        input: "file_content",
        expected: content,
      },
      {
        input: "file_size",
        expected: String(file.size),
      },
    ];
  },
  task: async (input: string) => {
    const file = Bun.file(testFilePath);

    if (input === "file_content") {
      return await file.text();
    } else if (input === "file_size") {
      return String(file.size);
    }

    return "";
  },
  scores: [exactMatch],
});
