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
    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cause: "cause" in error ? (error as any).cause : undefined,
          }
        : {
            name: "UnknownError",
            message: String(error),
            rawError: error,
          };

    return {
      success: false,
      testName,
      error: error as Error,
      message: `Test failed: ${errorDetails.message}`,
      errorDetails,
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
      const errorMessage =
        constructorError instanceof Error
          ? constructorError.message
          : String(constructorError);
      if (
        environment === "cloudflare-worker" &&
        errorMessage.includes(
          "Code generation from strings disallowed for this context",
        )
      ) {
        return {
          success: true,
          testName,
          message:
            "Nunjucks template test skipped - Cloudflare Workers does not support code generation from strings",
        };
      }

      const errorDetails =
        constructorError instanceof Error
          ? {
              name: constructorError.name,
              message: constructorError.message,
              stack: constructorError.stack,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cause:
                "cause" in constructorError
                  ? (constructorError as any).cause
                  : undefined,
              step: "Prompt constructor",
            }
          : {
              name: "UnknownError",
              message: String(constructorError),
              rawError: constructorError,
              step: "Prompt constructor",
            };

      return {
        success: false,
        testName,
        error: constructorError as Error,
        message: `Failed to create Prompt: ${errorDetails.message}`,
        errorDetails,
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
      if (
        environment === "cloudflare-worker" &&
        errorMessage.includes(
          "Code generation from strings disallowed for this context",
        )
      ) {
        return {
          success: true,
          testName,
          message:
            "Nunjucks template test skipped - Cloudflare Workers does not support code generation from strings",
        };
      }

      const errorDetails =
        buildError instanceof Error
          ? {
              name: buildError.name,
              message: buildError.message,
              stack: buildError.stack,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cause:
                "cause" in buildError ? (buildError as any).cause : undefined,
              step: "build() call",
              templateFormat: "nunjucks",
              variables: {
                items: [
                  { name: "apple" },
                  { name: "banana" },
                  { name: "cherry" },
                ],
              },
            }
          : {
              name: "UnknownError",
              message: String(buildError),
              rawError: buildError,
              step: "build() call",
              templateFormat: "nunjucks",
            };

      return {
        success: false,
        testName,
        error: buildError as Error,
        message: `Failed to build prompt: ${errorDetails.message}`,
        errorDetails,
      };
    }

    try {
      assertEqual(
        nunjucksResult.messages[0]?.content,
        "Items: apple, banana, cherry",
        "Nunjucks template should render loop correctly",
      );
    } catch (assertError) {
      const errorDetails =
        assertError instanceof Error
          ? {
              name: assertError.name,
              message: assertError.message,
              stack: assertError.stack,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cause:
                "cause" in assertError ? (assertError as any).cause : undefined,
              step: "assertion",
              actualContent: nunjucksResult.messages[0]?.content,
              expectedContent: "Items: apple, banana, cherry",
            }
          : {
              name: "UnknownError",
              message: String(assertError),
              rawError: assertError,
              step: "assertion",
            };

      return {
        success: false,
        testName,
        error: assertError as Error,
        message: `Assertion failed: ${errorDetails.message}`,
        errorDetails,
      };
    }

    return {
      success: true,
      testName,
      message: "Nunjucks template test passed",
    };
  } catch (error) {
    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            cause: "cause" in error ? (error as any).cause : undefined,
            step: "unknown",
          }
        : {
            name: "UnknownError",
            message: String(error),
            rawError: error,
            step: "unknown",
          };

    return {
      success: false,
      testName,
      error: error as Error,
      message: `Test failed: ${errorDetails.message}`,
      errorDetails,
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
