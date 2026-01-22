import {
  registerTemplatePlugin,
  useTemplateRenderer,
  Prompt,
} from "braintrust";
import { nunjucksPlugin } from "@braintrust/templates-nunjucks";
import {
  displayTestResults,
  hasFailures,
  type TestResult,
} from "../../../shared/dist/index.mjs";

// Register and activate the nunjucks plugin
registerTemplatePlugin(nunjucksPlugin);
useTemplateRenderer("nunjucks");

async function main() {
  const results: TestResult[] = [];

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
      results.push({
        status: "pass",
        name: "Nunjucks conditional rendering",
      });
    } else {
      results.push({
        status: "fail",
        name: "Nunjucks conditional rendering",
        error: {
          message: `Expected "Hello, World!", got "${conditionalResult.messages[0]?.content}"`,
        },
      });
    }

    // Test 3: Verify templateFormat option is required
    try {
      const noFormatPrompt = new Prompt(
        {
          name: "nunjucks-no-format-test",
          slug: "nunjucks-no-format-test",
          prompt_data: {
            prompt: {
              type: "chat",
              messages: [
                {
                  role: "user",
                  content: "{{ variable }}",
                },
              ],
            },
            options: { model: "gpt-4" },
          },
        },
        {},
        false,
      );

      // Without templateFormat, it should not render nunjucks templates
      const noFormatResult = noFormatPrompt.build({ variable: "test" });

      // Should NOT have rendered the template (no nunjucks processing)
      if (noFormatResult.messages[0]?.content === "{{ variable }}") {
        results.push({
          status: "pass",
          name: "Nunjucks requires explicit templateFormat option",
        });
      } else {
        results.push({
          status: "fail",
          name: "Nunjucks requires explicit templateFormat option",
          error: {
            message: `Without templateFormat, expected "{{ variable }}", got "${noFormatResult.messages[0]?.content}"`,
          },
        });
      }
    } catch (error) {
      results.push({
        status: "fail",
        name: "Nunjucks requires explicit templateFormat option",
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  } catch (error) {
    results.push({
      status: "fail",
      name: "Template-nunjucks integration",
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }

  displayTestResults({
    scenarioName: "Templates-Nunjucks Test Results",
    results,
  });

  if (hasFailures(results)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
