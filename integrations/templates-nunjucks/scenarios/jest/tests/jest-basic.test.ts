import { runNunjucksTests } from "../shared/run-tests.mjs";

test("Templates-Nunjucks basic behavior", async () => {
  const results = await runNunjucksTests();
  const failures = results.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    const msg = failures
      .map((f) => `${f.name}: ${f.error?.message ?? "failed"}`)
      .join("\n");
    throw new Error(`Found failures:\n${msg}`);
  }
});
