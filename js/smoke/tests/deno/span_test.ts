// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@^1.0.14";
import {
  runSpanSmokeTest,
  runMustacheTemplateTest,
  runNunjucksTemplateTest,
} from "../span/span_test_helper.ts";

/**
 * This is a simple test to send a span to the braintrust API
 * Uses BRAINTRUST_BUILD_DIR environment variable to import the braintrust package
 * ie. BRAINTRUST_BUILD_DIR=./package/dist/browser.mjs
 */
export async function runBrowserLoggerSmokeTest() {
  const buildDir = Deno.env.get("BRAINTRUST_BUILD_DIR");
  if (!buildDir) {
    throw new Error("BRAINTRUST_BUILD_DIR environment variable is not set");
  }

  const { initLogger, _exportsForTestingOnly, Prompt } = await import(
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

  // Test mustache template with simple variable
  const mustacheResult = runMustacheTemplateTest(Prompt);

  assertEquals(
    mustacheResult.messages[0]?.content,
    "Hello, World!",
    "Mustache template should render simple variable",
  );

  console.log("Mustache template test passed");

  // Test nunjucks template with loop
  const nunjucksResult = runNunjucksTemplateTest(Prompt);

  assertEquals(
    nunjucksResult.messages[0]?.content,
    "Items: apple, banana, cherry",
    "Nunjucks template should render loop correctly",
  );

  console.log("Nunjucks template test passed");
}

Deno.test("Create a span", async () => {
  await runBrowserLoggerSmokeTest();
});
