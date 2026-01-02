import { startSpan, traced } from "../../logger";
import { SpanTypeAttribute } from "../../../util/index";
import type {
  TestConfig,
  TestContext,
  TestFunction,
  DescribeFunction,
  WrappedTest,
  WrappedDescribe,
  WrapperConfig,
} from "./types";

export function wrapTest(
  originalTest: TestFunction,
  config: WrapperConfig,
): WrappedTest {
  const wrappedTest: any = function (
    name: string,
    configOrFn: TestConfig | ((context: any) => void | Promise<void>),
    maybeFn?: (context: TestContext) => void | Promise<void>,
  ) {
    const isEnhanced = typeof configOrFn !== "function";
    const testConfig = isEnhanced ? (configOrFn as TestConfig) : undefined;
    const fn = isEnhanced ? maybeFn! : (configOrFn as any);

    return originalTest(name, async (vitestContext: any) => {
      return await traced(
        async (span) => {
          try {
            if (testConfig) {
              const params: TestContext = {
                input: testConfig.input,
                expected: testConfig.expected,
                metadata: testConfig.metadata,
              };
              await fn({ ...vitestContext, ...params });
            } else {
              await fn(vitestContext);
            }
          } catch (error) {
            span.log({
              metadata: {
                error:
                  error instanceof Error
                    ? {
                        message: error.message,
                        name: error.name,
                        stack: error.stack,
                      }
                    : String(error),
              },
            });
            throw error;
          }
        },
        {
          name: config.projectName ? `${config.projectName}:${name}` : name,
          spanAttributes: {
            type: SpanTypeAttribute.TASK,
          },
          event: testConfig
            ? {
                input: testConfig.input,
                expected: testConfig.expected,
                metadata: testConfig.metadata,
                tags: testConfig.tags,
              }
            : undefined,
        },
      );
    });
  };

  // Copy over Vitest modifiers
  if (originalTest.skip) wrappedTest.skip = wrappedTest;
  if (originalTest.only) wrappedTest.only = wrappedTest;
  if (originalTest.concurrent) wrappedTest.concurrent = wrappedTest;
  if (originalTest.todo) wrappedTest.todo = originalTest.todo;
  if (originalTest.each) wrappedTest.each = originalTest.each;

  return wrappedTest as WrappedTest;
}

export function wrapDescribe(
  originalDescribe: DescribeFunction,
  config: WrapperConfig,
): WrappedDescribe {
  const wrappedDescribe: any = function (
    suiteName: string,
    factory: () => void,
  ) {
    return originalDescribe(suiteName, factory);
  };

  // Copy over Vitest modifiers
  if (originalDescribe.skip) wrappedDescribe.skip = wrappedDescribe;
  if (originalDescribe.only) wrappedDescribe.only = wrappedDescribe;
  if (originalDescribe.concurrent) wrappedDescribe.concurrent = wrappedDescribe;
  if (originalDescribe.todo) wrappedDescribe.todo = originalDescribe.todo;
  if (originalDescribe.each) wrappedDescribe.each = originalDescribe.each;

  return wrappedDescribe as WrappedDescribe;
}
