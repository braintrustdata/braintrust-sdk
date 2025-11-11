// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@^1.0.14";
import { runSpanSmokeTest } from "../span/span_test_helper.ts";

// Helper function to run the smoke test
export async function runBrowserLoggerSmokeTest() {
  const buildDir = Deno.env.get("BRAINTRUST_BUILD_DIR");
  if (!buildDir) {
    throw new Error("BRAINTRUST_BUILD_DIR environment variable is not set");
  }

  const { initLogger, _exportsForTestingOnly } = await import(
    `file://${Deno.env.get("BRAINTRUST_BUILD_DIR")}`
  );

  const events = await runSpanSmokeTest({
    initLogger,
    testingExports: _exportsForTestingOnly,
    projectName: "deno-browser-logger",
  });

  assertEquals(events.length, 1, "Exactly one span should be captured");
  const event = events[0];

  assertEquals(event.input, "What is the capital of France?");
  assertEquals(event.output, "Paris");
  assertEquals(event.expected, "Paris");

  console.log("Deno smoke test passed");
}

Deno.test("Create a span", async () => {
  await runBrowserLoggerSmokeTest();
});
