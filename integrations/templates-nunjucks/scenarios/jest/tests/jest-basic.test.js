const {
  runTests,
  testMustacheTemplate,
  testNunjucksTemplate,
} = require("../../../../../js/smoke/shared/dist/index.js");
const braintrust = require("braintrust");
const { nunjucksPlugin } = require("@braintrust/templates-nunjucks-js");

test("Templates-Nunjucks basic behavior", async () => {
  // Register nunjucks plugin before running tests
  braintrust.registerTemplatePlugin(nunjucksPlugin);

  const { failed } = await runTests({
    name: "templates-nunjucks-jest",
    braintrust,
    tests: [testMustacheTemplate, testNunjucksTemplate],
    skipCoverage: true,
  });

  if (failed.length > 0) {
    const msg = failed
      .map((f) => `${f.name}: ${f.error ?? "failed"}`)
      .join("\n");
    throw new Error(`Found failures:\n${msg}`);
  }
});
