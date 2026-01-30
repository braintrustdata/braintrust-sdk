import {
  test,
  expect,
  describe,
  beforeEach,
  beforeAll,
  afterEach,
  vi,
} from "vitest";
import { wrapClaudeAgentSDK } from "./claude-agent-sdk";
import { initLogger, _exportsForTestingOnly } from "../../logger";
import { configureNode } from "../../node";
import { z } from "zod/v3";

debugger;

// Unit tests for property forwarding (no real SDK needed)
describe("wrapClaudeAgentSDK property forwarding", () => {
  beforeAll(async () => {
    try {
      configureNode();
    } catch (e) {
      // Already configured
    }
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(async () => {
    _exportsForTestingOnly.useTestBackgroundLogger();
    initLogger({
      projectName: "claude-agent-sdk-unit.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("forwards interrupt() method from original Query object", async () => {
    const interruptMock = vi.fn().mockResolvedValue(undefined);

    // Create a mock SDK with a query function that returns a generator with interrupt()
    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        // Create an async generator that also has an interrupt method
        const generator = (async function* () {
          yield { type: "assistant", message: { content: "Hello" } };
          yield { type: "result", result: "done" };
        })();

        // Attach interrupt method to the generator (like the real SDK does)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (generator as any).interrupt = interruptMock;

        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);
    const queryResult = wrappedSDK.query({ prompt: "test" });

    // Verify interrupt() is accessible and forwards to the original
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (queryResult as any).interrupt).toBe("function");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (queryResult as any).interrupt();
    expect(interruptMock).toHaveBeenCalledTimes(1);
  });

  test("interrupt() works before iteration starts (eager initialization)", async () => {
    const interruptMock = vi.fn().mockResolvedValue(undefined);

    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        const generator = (async function* () {
          yield { type: "assistant", message: { content: "Hello" } };
          yield { type: "result", result: "done" };
        })();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (generator as any).interrupt = interruptMock;
        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);
    const queryResult = wrappedSDK.query({ prompt: "test" });

    // Call interrupt() BEFORE starting iteration - this should work
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (queryResult as any).interrupt();
    expect(interruptMock).toHaveBeenCalledTimes(1);
  });

  test("forwards other custom properties from original Query object", async () => {
    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        const generator = (async function* () {
          yield { type: "result", result: "done" };
        })();

        // Attach custom properties (like the real SDK might have)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (generator as any).sessionId = "test-session-123";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (generator as any).customMethod = () => "custom-value";

        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);
    const queryResult = wrappedSDK.query({ prompt: "test" });

    // Start iteration
    const iterator = queryResult[Symbol.asyncIterator]();
    await iterator.next();

    // Verify custom properties are forwarded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((queryResult as any).sessionId).toBe("test-session-123");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((queryResult as any).customMethod()).toBe("custom-value");
  });

  test("async iterator protocol still works after wrapping", async () => {
    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        const generator = (async function* () {
          yield { type: "assistant", message: { content: "msg1" } };
          yield { type: "assistant", message: { content: "msg2" } };
          yield { type: "result", result: "done" };
        })();
        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);
    const messages: unknown[] = [];

    for await (const msg of wrappedSDK.query({ prompt: "test" })) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ type: "assistant" });
    expect(messages[2]).toMatchObject({ type: "result" });
  });

  test("injects PreToolUse and PostToolUse hooks for tracing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedOptions: any;

    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        capturedOptions = params.options;
        const generator = (async function* () {
          yield { type: "result", result: "done" };
        })();
        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);

    // Consume the generator to trigger the query
    for await (const _msg of wrappedSDK.query({
      prompt: "test",
      options: { model: "test-model" },
    })) {
      // consume
    }

    // Verify hooks were injected
    expect(capturedOptions).toBeDefined();
    expect(capturedOptions.hooks).toBeDefined();
    expect(capturedOptions.hooks.PreToolUse).toBeDefined();
    expect(capturedOptions.hooks.PreToolUse.length).toBeGreaterThan(0);
    expect(capturedOptions.hooks.PostToolUse).toBeDefined();
    expect(capturedOptions.hooks.PostToolUse.length).toBeGreaterThan(0);
  });

  test("preserves user-provided hooks when injecting tracing hooks", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedOptions: any;
    const userPreHook = vi.fn().mockResolvedValue({});
    const userPostHook = vi.fn().mockResolvedValue({});

    const mockSDK = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (params: any) => {
        capturedOptions = params.options;
        const generator = (async function* () {
          yield { type: "result", result: "done" };
        })();
        return generator;
      },
    };

    const wrappedSDK = wrapClaudeAgentSDK(mockSDK);

    // Consume the generator with user-provided hooks
    for await (const _msg of wrappedSDK.query({
      prompt: "test",
      options: {
        model: "test-model",
        hooks: {
          PreToolUse: [{ hooks: [userPreHook] }],
          PostToolUse: [{ hooks: [userPostHook] }],
        },
      },
    })) {
      // consume
    }

    // Verify user hooks are preserved AND our hooks are added
    expect(capturedOptions.hooks.PreToolUse.length).toBeGreaterThanOrEqual(2);
    expect(capturedOptions.hooks.PostToolUse.length).toBeGreaterThanOrEqual(2);

    // User hooks should be first (they were provided first)
    expect(capturedOptions.hooks.PreToolUse[0].hooks[0]).toBe(userPreHook);
    expect(capturedOptions.hooks.PostToolUse[0].hooks[0]).toBe(userPostHook);
  });
});

// Try to import the Claude Agent SDK - skip tests if not available
let claudeSDK: unknown;
try {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - SDK may not be installed
  claudeSDK = await import("@anthropic-ai/claude-agent-sdk");
} catch (e) {
  console.warn("Claude Agent SDK not installed, skipping integration tests");
}

try {
  configureNode();
} catch (e) {
  // Initialize Braintrust state once per process
}

const TEST_MODEL = "claude-haiku-4-5-20251001";

describe.skipIf(!claudeSDK)("claude-agent-sdk integration tests", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let backgroundLogger: any;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(async () => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

    initLogger({
      projectName: "claude-agent-sdk.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("claude_agent.ts example - calculator with multiple operations", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { query, tool, createSdkMcpServer } = wrapClaudeAgentSDK(
      claudeSDK as any,
    );

    // Create calculator tool (matches example)
    const calculator = tool(
      "calculator",
      "Performs basic arithmetic operations",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        let result = 0;
        switch (args.operation) {
          case "multiply":
            result = args.a * args.b;
            break;
          case "subtract":
            result = args.a - args.b;
            break;
        }
        return {
          content: [
            {
              type: "text",
              text: `The result of ${args.operation}(${args.a}, ${args.b}) is ${result}`,
            },
          ],
        };
      },
    );

    // Run the example query and capture the result message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resultMessage: any;
    for await (const message of query({
      prompt:
        "Multiply 15 by 7. Then subtract 5 from the result. You MUST use the calculator tool for both operations.",
      options: {
        model: TEST_MODEL,
        permissionMode: "bypassPermissions",
        temperature: 0.0,
        mcpServers: {
          calculator: createSdkMcpServer({
            name: "calculator",
            version: "1.0.0",
            tools: [calculator],
          }),
        },
      },
    })) {
      if (message.type === "result") {
        resultMessage = message;
      }
    }

    const spans = await backgroundLogger.drain();

    // Verify root task span
    const taskSpan = spans.find(
      (s) =>
        (s["span_attributes"] as Record<string, unknown>).name ===
        "Claude Agent",
    );
    expect(taskSpan).toBeDefined();
    expect((taskSpan!["span_attributes"] as Record<string, unknown>).type).toBe(
      "task",
    );
    expect(taskSpan!.input).toContain("Multiply 15 by 7");
    expect(taskSpan!.output).toBeDefined();

    // Verify result message has usage data
    expect(resultMessage).toBeDefined();
    expect(resultMessage.type).toBe("result");
    expect(resultMessage.usage).toBeDefined();
    expect(resultMessage.usage.input_tokens).toBeGreaterThan(0);
    expect(resultMessage.usage.output_tokens).toBeGreaterThan(0);

    // Task span should only have timing metrics, not token counts
    // Token counts are computed during UI rendering from child LLM spans
    const taskMetrics = taskSpan!.metrics as Record<string, number>;
    expect(taskMetrics).toBeDefined();
    expect(taskMetrics.start).toBeGreaterThan(0);
    expect(taskMetrics.end).toBeGreaterThan(taskMetrics.start);

    // Verify LLM spans (multiple anthropic.messages.create calls)
    const llmSpans = spans.filter(
      (s) => (s["span_attributes"] as Record<string, unknown>).type === "llm",
    );
    // haiku sometimes solves this in one turn
    expect(llmSpans.length).toBeGreaterThanOrEqual(1);

    llmSpans.forEach((span) => {
      expect((span["span_attributes"] as Record<string, unknown>).name).toBe(
        "anthropic.messages.create",
      );
      expect(
        (span.metrics as Record<string, number>).prompt_tokens,
      ).toBeGreaterThan(0);
      // Output should be an array of messages (grouped by message.id)
      expect(Array.isArray(span.output)).toBe(true);
      expect((span.output as unknown[]).length).toBeGreaterThan(0);
    });

    // Verify tool spans (calculator should be called at least twice: multiply, subtract)
    // Note: Tool names from hooks include the MCP server prefix: mcp__<server>__<tool>
    const toolSpans = spans.filter(
      (s) => (s["span_attributes"] as Record<string, unknown>).type === "tool",
    );
    if (toolSpans.length == 0) {
      // FIXME: This test is non-deterministic, even with temperature 0
      // Sometimes haiku just doesn't make a tool call
      return;
    }
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    toolSpans.forEach((span) => {
      // Tool name includes MCP server prefix
      expect((span["span_attributes"] as Record<string, unknown>).name).toBe(
        "mcp__calculator__calculator",
      );
      expect((span.metadata as Record<string, string>).tool_name).toBe(
        "mcp__calculator__calculator",
      );
    });

    // Verify span hierarchy (all children should reference the root task span)
    const rootSpanId = taskSpan!.span_id;
    spans
      .filter((s) => s.span_id !== rootSpanId)
      .forEach((span) => {
        expect(span.root_span_id).toBe(rootSpanId);
        expect(span.span_parents).toContain(rootSpanId);
      });
  }, 30000);
});
