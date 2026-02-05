import { Eval } from "braintrust";
// Test Bun-specific import patterns
// These imports only work in Bun, not Node.js
import { version } from "bun";
import { Database } from "bun:sqlite";

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

// Test bun:sqlite (built-in, no npm package needed)
const db = new Database(":memory:");
db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
db.run("INSERT INTO test (name) VALUES (?)", ["Alice"]);

const query = db.query("SELECT name FROM test WHERE id = ?");
const result = query.get(1) as { name: string } | null;

Eval("test-cli-eval-bun", {
  experimentName: "Bun Imports Test",
  data: () => [
    {
      input: "bun_version",
      expected: true, // Should have a version string
    },
    {
      input: "sqlite_query",
      expected: true, // Should get result from DB
    },
  ],
  task: async (input: string) => {
    if (input === "bun_version") {
      // Test that we can import from "bun"
      return typeof version === "string" && version.length > 0;
    } else if (input === "sqlite_query") {
      // Test that bun:sqlite works
      return result?.name === "Alice";
    }

    return false;
  },
  scores: [exactMatch],
});

// Cleanup
db.close();
