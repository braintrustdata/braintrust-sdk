// @ts-nocheck
/**
 * Templates-Nunjucks Deno smoke test - testing template rendering only
 */

import { assertEquals } from "@std/assert";
import {
  runTests,
  testMustacheTemplate,
  testNunjucksTemplate,
} from "@braintrust/smoke-test-shared";
import * as braintrust from "braintrust";
import { registerTemplatePlugin } from "braintrust";
import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";

// Register nunjucks plugin before running tests
registerTemplatePlugin(nunjucksPlugin);

Deno.test("Run template tests with Nunjucks", async () => {
  const { failed } = await runTests({
    name: "templates-nunjucks-deno",
    braintrust,
    tests: [
      testMustacheTemplate,
      testNunjucksTemplate, // Should pass since @braintrust/templates-nunjucks-js is installed
    ],
  });

  assertEquals(failed.length, 0, "All template tests should pass");
});
