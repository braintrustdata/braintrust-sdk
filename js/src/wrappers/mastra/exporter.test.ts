import { describe, test, expect } from "vitest";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { openai } from "@ai-sdk/openai";
import { createTool } from "@mastra/core/tools";
import { z } from "zod/v3";

import { MastraExporter } from "./exporter";
import {
  _exportsForTestingOnly,
  initLogger,
} from "../../logger";

// Initialize test state for logger utilities
_exportsForTestingOnly.setInitialTestState();

const OPENAI_MODEL = "gpt-4o-mini";
const TEST_SUITE_OPTIONS = { timeout: 20000, retry: 2 } as const;

describe("MastraExporter", TEST_SUITE_OPTIONS, () => {
  test("exporter captures agent generate with spans and metrics", async () => {
    // Setup
    await _exportsForTestingOnly.simulateLoginForTests();
    const testLogger = _exportsForTestingOnly.useTestBackgroundLogger();

    const logger = initLogger({
      projectName: "exporter.test.ts",
      projectId: "test-project-id",
    });

    const exporter = new MastraExporter({
      logger,
    });

    const model = openai(OPENAI_MODEL);
    const calculatorTool = createTool({
      id: "calculator",
      description: "Add two numbers",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }) as any,
      outputSchema: z.object({
        result: z.number(),
      }) as any,
      execute: async ({ context }) => {
        const { a, b } = context;
        return { result: a + b };
      },
    });

    const agent = new Agent({
      name: "Test Agent",
      instructions: "You are a helpful assistant.",
      model,
      tools: { calculatorTool },
    });

    const mastra = new Mastra({
      agents: { testAgent: agent },
      observability: {
        configs: {
          braintrust: {
            serviceName: "test",
            exporters: [exporter],
          },
        },
      },
    });

    // Run test
    const testAgent = mastra.getAgent("testAgent");

    await logger.traced(async () => {
      await testAgent.generate("What is 2+2?");
    }, { name: "test-span" });

    const spans = (await testLogger.drain()) as any[];

    // Check we have multiple spans (parent + child)
    expect(spans.length).toBeGreaterThan(1);

    const testSpan = spans.find((s) => s?.span_attributes?.name === "test-span");
    expect(testSpan).toBeTruthy();

    // Check model span exists with metrics
    const modelSpan = spans.find(
      (s) => s?.span_attributes?.type === "llm",
    );
    expect(modelSpan).toBeTruthy();
    expect(modelSpan?.metrics?.prompt_tokens).toBeGreaterThan(0);
    expect(modelSpan?.metadata?.model).toBe(OPENAI_MODEL);

    // Cleanup
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });
});
