/**
 * Prompt templating test suite
 * Tests Mustache and Nunjucks template rendering in Prompt class
 */

import type { TestResult } from "../helpers/types";
import { assertEqual } from "../helpers/assertions";

/**
 * Interface for accessing Prompt class from braintrust module
 * Uses a flexible type to accommodate the actual Prompt class structure
 * which has generics and complex return types
 */
export interface PromptModule {
  Prompt: {
    new (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defaults: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      noTrace: boolean,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any;
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
      status: "pass" as const,
      name: testName,
      message: "Mustache template test passed",
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
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

    let nunjucksPrompt;
    try {
      nunjucksPrompt = new Prompt(
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
    } catch (constructorError) {
      return {
        status: "fail" as const,
        name: testName,
        error: {
          message:
            constructorError instanceof Error
              ? constructorError.message
              : String(constructorError),
          stack:
            constructorError instanceof Error
              ? constructorError.stack
              : undefined,
        },
        message: `Failed to create Prompt: ${constructorError instanceof Error ? constructorError.message : String(constructorError)}`,
      };
    }

    let nunjucksResult;
    try {
      nunjucksResult = nunjucksPrompt.build(
        {
          items: [{ name: "apple" }, { name: "banana" }, { name: "cherry" }],
        },
        { templateFormat: "nunjucks" },
      );
    } catch (buildError) {
      return {
        status: "fail" as const,
        name: testName,
        error: {
          message:
            buildError instanceof Error
              ? buildError.message
              : String(buildError),
          stack: buildError instanceof Error ? buildError.stack : undefined,
        },
        message: `Failed to build prompt: ${buildError instanceof Error ? buildError.message : String(buildError)}`,
      };
    }

    try {
      const expected = "Items: apple, banana, cherry";
      const actual = nunjucksResult.messages[0]?.content;
      assertEqual(
        actual,
        expected,
        `Nunjucks template should render loop correctly`,
      );
    } catch (assertError) {
      return {
        status: "fail" as const,
        name: testName,
        error: {
          message:
            assertError instanceof Error
              ? assertError.message
              : String(assertError),
          stack: assertError instanceof Error ? assertError.stack : undefined,
        },
        message: `Assertion failed: ${assertError instanceof Error ? assertError.message : String(assertError)}`,
      };
    }

    return {
      status: "pass" as const,
      name: testName,
      message: "Nunjucks template test passed",
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
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
