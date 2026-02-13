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
import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";

Deno.test("Run template tests with Nunjucks", async () => {
  // Register nunjucks plugin before running tests
  braintrust.registerTemplatePlugin(nunjucksPlugin);

  const { failed } = await runTests({
    name: "templates-nunjucks-deno",
    braintrust,
    tests: [testMustacheTemplate, testNunjucksTemplate],
    skipCoverage: true,
  });

  assertEquals(failed.length, 0, "All template tests should pass");
});
