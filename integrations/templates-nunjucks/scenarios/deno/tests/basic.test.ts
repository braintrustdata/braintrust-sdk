import { runNunjucksTests } from "../shared/run-tests.mjs";

Deno.test("Templates-Nunjucks basic behavior", async () => {
  const results = await runNunjucksTests();
  const failures = results.filter((r) => r.status === "fail");
  if (failures.length > 0) {
    throw new Error(
      failures
        .map((f) => `${f.name}: ${f.error?.message ?? "failed"}`)
        .join("\n"),
    );
  }
});
