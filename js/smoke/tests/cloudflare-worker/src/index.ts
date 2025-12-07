import { initLogger, _exportsForTestingOnly } from "braintrust";

interface Env {}

interface TestResult {
  success: boolean;
  message: string;
  details?: unknown;
}

async function runSmokeTest(): Promise<TestResult> {
  try {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();

    const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

    const logger = initLogger({
      projectName: "cloudflare-worker-smoke-test",
      projectId: "test-project-id",
    });

    const span = logger.startSpan({ name: "cloudflare.smoke" });
    span.log({
      input: "What is the capital of France?",
      output: "Paris",
      expected: "Paris",
      metadata: { transport: "cloudflare-worker-smoke-test" },
    });
    span.end();

    await logger.flush();

    const events = await backgroundLogger.drain();

    _exportsForTestingOnly.clearTestBackgroundLogger();

    if (events.length === 0) {
      return {
        success: false,
        message: "No spans were captured by the background logger",
      };
    }

    const spanEvent = events[0] as Record<string, unknown>;

    if (spanEvent.input !== "What is the capital of France?") {
      return {
        success: false,
        message: `Expected input "What is the capital of France?", got "${spanEvent.input}"`,
        details: spanEvent,
      };
    }

    if (spanEvent.output !== "Paris") {
      return {
        success: false,
        message: `Expected output "Paris", got "${spanEvent.output}"`,
        details: spanEvent,
      };
    }

    if (spanEvent.expected !== "Paris") {
      return {
        success: false,
        message: `Expected expected "Paris", got "${spanEvent.expected}"`,
        details: spanEvent,
      };
    }

    return {
      success: true,
      message: "Cloudflare Worker smoke test passed",
      details: { spanCount: events.length },
    };
  } catch (error) {
    return {
      success: false,
      message: `Error during smoke test: ${error instanceof Error ? error.message : String(error)}`,
      details: error instanceof Error ? error.stack : undefined,
    };
  }
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      const result = await runSmokeTest();
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
        status: result.success ? 200 : 500,
      });
    }

    return new Response(
      "Braintrust Cloudflare Worker Smoke Test\n\nGET /test - Run smoke test",
      {
        headers: { "Content-Type": "text/plain" },
      },
    );
  },
};
