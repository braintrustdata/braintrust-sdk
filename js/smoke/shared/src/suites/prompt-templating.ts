/**
 * Prompt templating test suite
 * Tests Mustache and Nunjucks template rendering in Prompt class
 */

import type { TestResult } from "../helpers/types";
import { assertEqual } from "../helpers/assertions";

/**
 * Interface for accessing Prompt class from braintrust module
 */
export interface PromptModule {
  Prompt: new (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaults: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    noTrace: boolean,
  ) => {
    build: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vars: any,
      options?: { templateFormat?: "mustache" | "nunjucks" },
    ) => {
      messages: Array<{ content: string }>;
    };
  };
}

/**
 * Test Mustache template rendering
 */
export async function testMustacheTemplate(
  module: PromptModule,
): Promise<TestResult> {
  const testName = "testMustacheTemplate";

  try {
    const { Prompt } = module;

    const mustachePrompt = new Prompt(
      {
        name: "mustache-test",
        slug: "mustache-test",
        prompt_data: {
          prompt: {
            type: "chat",
            messages: [
              {
                role: "user",
                content: "Hello, {{name}}!",
              },
            ],
          },
          options: {
            model: "gpt-4",
          },
        },
      },
      {},
      false,
    );

    const mustacheResult = mustachePrompt.build(
      { name: "World" },
      { templateFormat: "mustache" },
    );

    assertEqual(
      mustacheResult.messages[0]?.content,
      "Hello, World!",
      "Mustache template should render simple variable",
    );

    return {
      success: true,
      testName,
      message: "Mustache template test passed",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Test Nunjucks template rendering
 */
export async function testNunjucksTemplate(
  module: PromptModule,
): Promise<TestResult> {
  const testName = "testNunjucksTemplate";

  try {
    const { Prompt } = module;

    const nunjucksPrompt = new Prompt(
      {
        name: "nunjucks-test",
        slug: "nunjucks-test",
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
          options: {
            model: "gpt-4",
          },
        },
      },
      {},
      false,
    );

    const nunjucksResult = nunjucksPrompt.build(
      {
        items: [{ name: "apple" }, { name: "banana" }, { name: "cherry" }],
      },
      { templateFormat: "nunjucks" },
    );

    assertEqual(
      nunjucksResult.messages[0]?.content,
      "Items: apple, banana, cherry",
      "Nunjucks template should render loop correctly",
    );

    return {
      success: true,
      testName,
      message: "Nunjucks template test passed",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
    };
  }
}

/**
 * Run all prompt templating tests
 */
export async function runPromptTemplatingTests(
  module: PromptModule,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  results.push(await testMustacheTemplate(module));
  results.push(await testNunjucksTemplate(module));

  return results;
}
