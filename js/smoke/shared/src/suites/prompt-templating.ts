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
      success: true,
      testName,
      message: "Mustache template test passed",
    };
  } catch (error) {
    return {
      success: false,
      testName,
      error: error as Error,
      message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test Nunjucks template rendering
 */
export async function testNunjucksTemplate(
  module: PromptModule,
  environment?: string,
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
        success: false,
        testName,
        error: constructorError as Error,
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
      const errorMessage =
        buildError instanceof Error ? buildError.message : String(buildError);

      const isUnsupported = errorMessage.includes(
        "Nunjucks templating is not supported in this build",
      );

      if (
        (environment === "browser" ||
          environment === "cloudflare-worker-browser-no-compat" ||
          environment === "cloudflare-worker-browser-node-compat" ||
          environment === "nextjs-edge-runtime") &&
        isUnsupported
      ) {
        return {
          success: true,
          testName,
          message:
            "Nunjucks template test passed - threw expected unsupported error",
        };
      }

      // In Cloudflare Workers (even with nodejs_compat), string-based template codegen is disallowed.
      if (
        environment === "cloudflare-worker-node-node-compat" &&
        errorMessage.includes(
          "Code generation from strings disallowed for this context",
        )
      ) {
        return {
          success: true,
          testName,
          message:
            "Nunjucks template test passed - threw expected codegen-disallowed error",
        };
      }

      return {
        success: false,
        testName,
        error: buildError as Error,
        message: `Failed to build prompt: ${errorMessage}`,
      };
    }

    try {
      const expected = "Items: apple, banana, cherry";
      const actual = nunjucksResult.messages[0]?.content;
      assertEqual(
        actual,
        expected,
        `Nunjucks template should render loop correctly (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
      );
    } catch (assertError) {
      return {
        success: false,
        testName,
        error: assertError as Error,
        message: `Assertion failed: ${assertError instanceof Error ? assertError.message : String(assertError)}`,
      };
    }

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
      message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run all prompt templating tests
 */
export async function runPromptTemplatingTests(
  module: PromptModule,
  environment?: string,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  results.push(await testMustacheTemplate(module));
  results.push(await testNunjucksTemplate(module, environment));

  return results;
}
