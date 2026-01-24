import { registerTemplatePlugin, Prompt } from "braintrust";
import { nunjucksPlugin } from "@braintrust/templates-nunjucks-js";
import {
  displayTestResults,
  hasFailures,
} from "../../../../js/smoke/shared/dist/index.mjs";

// Register plugin (idempotent)
registerTemplatePlugin(nunjucksPlugin);

export async function runNunjucksTests() {
  const results = [];

  try {
    // Test 1: Basic nunjucks template rendering
    const prompt = new Prompt(
      {
        name: "nunjucks-addon-test",
        slug: "nunjucks-addon-test",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content:
                  "Items: {% for item in items %}{{ item.name }}{% if not loop.last %}, {% endif %}{% endfor %}",
              },
            ],
          },
          options: { model: "gpt-4" },
        },
      },
      {},
      false,
    );

    const result = prompt.build(
      { items: [{ name: "apple" }, { name: "banana" }, { name: "cherry" }] },
      { templateFormat: "nunjucks" },
    );

    if (result.messages[0]?.content === "Items: apple, banana, cherry") {
      results.push({
        status: "pass",
        name: "Nunjucks template loop rendering",
      });
    } else {
      results.push({
        status: "fail",
        name: "Nunjucks template loop rendering",
        error: {
          message: `Expected "Items: apple, banana, cherry", got "${result.messages[0]?.content}"`,
        },
      });
    }

    // Test 2: Conditional rendering
    const conditionalPrompt = new Prompt(
      {
        name: "nunjucks-conditional-test",
        slug: "nunjucks-conditional-test",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content:
                  "{% if showGreeting %}Hello, {{ name }}!{% else %}Goodbye!{% endif %}",
              },
            ],
          },
          options: { model: "gpt-4" },
        },
      },
      {},
      false,
    );

    const conditionalResult = conditionalPrompt.build(
      { showGreeting: true, name: "World" },
      { templateFormat: "nunjucks" },
    );

    if (conditionalResult.messages[0]?.content === "Hello, World!") {
      results.push({ status: "pass", name: "Nunjucks conditional rendering" });
    } else {
      results.push({
        status: "fail",
        name: "Nunjucks conditional rendering",
        error: {
          message: `Expected "Hello, World!", got "${conditionalResult.messages[0]?.content}"`,
        },
      });
    }

    // Test 3: Verify nunjucks-specific syntax requires templateFormat
    try {
      const noFormatPrompt = new Prompt(
        {
          name: "nunjucks-no-format-test",
          slug: "nunjucks-no-format-test",
          prompt_data: {
            prompt: {
              type: "chat",
              messages: [
                { role: "user", content: "{% if condition %}yes{% endif %}" },
              ],
            },
            options: { model: "gpt-4" },
          },
        },
        {},
        false,
      );

      const noFormatResult = noFormatPrompt.build({ condition: true });

      if (
        noFormatResult.messages[0]?.content ===
        "{% if condition %}yes{% endif %}"
      ) {
        results.push({
          status: "pass",
          name: "Nunjucks-specific syntax requires explicit templateFormat option",
        });
      } else {
        results.push({
          status: "fail",
          name: "Nunjucks-specific syntax requires explicit templateFormat option",
          error: {
            message: `Without templateFormat, expected "{% if condition %}yes{% endif %}", got "${noFormatResult.messages[0]?.content}"`,
          },
        });
      }
    } catch (error) {
      results.push({
        status: "fail",
        name: "Nunjucks-specific syntax requires explicit templateFormat option",
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  } catch (error) {
    results.push({
      status: "fail",
      name: "Template-nunjucks integration",
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }

  // Return results for programmatic runners
  return results;
}

export function reportAndExit(results, exitOnFail = true) {
  displayTestResults({
    scenarioName: "Templates-Nunjucks Test Results",
    results,
  });
  if (exitOnFail && hasFailures(results)) process.exit(1);
}
