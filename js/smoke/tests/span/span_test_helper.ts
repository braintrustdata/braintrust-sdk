interface LoggerSpan {
  log: (payload: Record<string, unknown>) => void;
  end: () => void;
}

interface LoggerInstance {
  startSpan: (options: { name: string }) => LoggerSpan;
  flush: () => Promise<void>;
}

interface BackgroundLogger {
  drain: () => Promise<unknown[]>;
}

export interface TestingExports {
  setInitialTestState: () => void;
  simulateLoginForTests: () => Promise<unknown> | unknown;
  simulateLogoutForTests?: () => Promise<unknown> | unknown;
  useTestBackgroundLogger: () => BackgroundLogger;
  clearTestBackgroundLogger: () => void;
}

export interface RunSpanSmokeTestParams {
  initLogger: (options: {
    projectName: string;
    projectId: string;
  }) => LoggerInstance;
  testingExports: TestingExports;
  projectName: string;
}

const PROJECT_ID = "test-project-id";
const SPAN_NAME = "logger.smoke";

const SPAN_PAYLOAD = {
  input: "What is the capital of France?",
  output: "Paris",
  expected: "Paris",
  metadata: { transport: "smoke-test" },
} satisfies Record<string, unknown>;

export async function runSpanSmokeTest(
  params: RunSpanSmokeTestParams,
): Promise<unknown[]> {
  const { initLogger, testingExports, projectName } = params;

  testingExports.setInitialTestState();
  await testingExports.simulateLoginForTests();

  const backgroundLogger = testingExports.useTestBackgroundLogger();

  const logger = initLogger({
    projectName,
    projectId: PROJECT_ID,
  });

  const span = logger.startSpan({ name: SPAN_NAME });
  span.log(SPAN_PAYLOAD);
  span.end();

  await logger.flush();

  const events = await backgroundLogger.drain();

  try {
    return events;
  } finally {
    testingExports.clearTestBackgroundLogger();
    const { simulateLogoutForTests } = testingExports;
    if (typeof simulateLogoutForTests === "function") {
      await simulateLogoutForTests();
    }
  }
}

export interface MustacheTemplateTestResult {
  messages: Array<{ content: string }>;
}

export function runMustacheTemplateTest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Prompt: any,
): MustacheTemplateTestResult {
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

  return mustacheResult;
}

export interface NunjucksTemplateTestResult {
  messages: Array<{ content: string }>;
}

export function runNunjucksTemplateTest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Prompt: any,
): NunjucksTemplateTestResult {
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

  return nunjucksResult;
}
