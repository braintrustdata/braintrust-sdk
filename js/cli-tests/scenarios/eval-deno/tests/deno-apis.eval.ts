import { Eval } from "npm:braintrust";

// Test Deno-specific APIs
// These only work in Deno runtime, not Node.js

const exactMatch = ({
  output,
  expected,
}: {
  output: boolean;
  expected?: boolean;
}) => ({
  name: "exact_match",
  score: output === expected ? 1 : 0,
});

// Deno.env - Environment variable access (Deno-specific)
const testEnv = Deno.env.get("BRAINTRUST_API_KEY");

// Deno.readTextFile - Async file reading
const tempFile = await Deno.makeTempFile();
await Deno.writeTextFile(tempFile, "Hello from Deno!");
const fileContent = await Deno.readTextFile(tempFile);

Eval("test-cli-eval-deno", {
  experimentName: "Deno APIs Test",
  data: () => [
    {
      input: "env_access",
      expected: true,
    },
    {
      input: "file_io",
      expected: true,
    },
  ],
  task: async (input: string) => {
    if (input === "env_access") {
      // Test Deno.env works
      return typeof testEnv === "string";
    } else if (input === "file_io") {
      // Test Deno file APIs work
      return fileContent === "Hello from Deno!";
    }

    return false;
  },
  scores: [exactMatch],
});

// Cleanup
await Deno.remove(tempFile);
