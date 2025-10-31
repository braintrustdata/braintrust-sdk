import {
  test,
  expect,
  describe,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { wrapClaudeAgentSDK } from "./claude-agent-sdk";
import { initLogger, _exportsForTestingOnly } from "../../logger";
import { configureNode } from "../../node";
import { z } from "zod/v3";

debugger;

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
      prompt: "What is 15 multiplied by 7? Then subtract 5 from the result.",
      options: {
        model: TEST_MODEL,
        permissionMode: "bypassPermissions",
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
    expect(taskSpan!.input).toContain("15 multiplied by 7");
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
    expect(llmSpans.length).toBeGreaterThan(2); // Multiple turns expected
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
    const toolSpans = spans.filter(
      (s) => (s["span_attributes"] as Record<string, unknown>).type === "tool",
    );
    expect(toolSpans.length).toBeGreaterThanOrEqual(2);
    toolSpans.forEach((span) => {
      expect((span["span_attributes"] as Record<string, unknown>).name).toBe(
        "calculator",
      );
      expect((span.metadata as Record<string, string>).tool_name).toBe(
        "calculator",
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
