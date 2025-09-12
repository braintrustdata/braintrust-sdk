import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { wrapMastraAgent } from "./mastra";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
} from "../logger";

// Initialize test state for logger utilities
_exportsForTestingOnly.setInitialTestState();

const OPENAI_MODEL = "gpt-4o-mini";
const TEST_SUITE_OPTIONS = { timeout: 20000, retry: 2 } as const;

describe("mastra integration", TEST_SUITE_OPTIONS, () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({
      projectName: "mastra.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  function buildAgent() {
    const model = openai(OPENAI_MODEL);
    const calculatorTool = createTool({
      id: "calculator",
      description: "Perform basic mathematical operations",
      inputSchema: z.object({
        operation: z.enum(["add"]).describe("The operation to perform"),
        a: z.number().describe("The first number"),
        b: z.number().describe("The second number"),
      }),
      outputSchema: z.object({
        result: z.number(),
        operation: z.string(),
        a: z.number(),
        b: z.number(),
        formula: z.string(),
      }),
      execute: async ({ context }) => {
        return (await context.a) + context.b;
      },
    });
    const agent = new Agent({
      name: "Demo Assistant",
      instructions: "You are a helpful assistant.",
      model,
      tools: { calculatorTool },
    });
    return agent;
  }

  test("generateVNext", async () => {
    expect(await testLogger.drain()).toHaveLength(0);
    const agent = buildAgent();
    wrapMastraAgent(agent, { span_name: "demoAgent" });

    const res: any = await agent.generateVNext([
      { role: "user", content: "What is 2+2?" },
    ]);

    const spans = (await testLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) => s?.span_attributes?.name === "demoAgent.generateVNext",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(
      typeof res?.text === "string" || typeof wrapperSpan.output === "string",
    ).toBe(true);
  });

  test("streamVNext", async () => {
    expect(await testLogger.drain()).toHaveLength(0);
    const agent = buildAgent();
    wrapMastraAgent(agent as any, { span_name: "demoAgent" });

    const res: any = await agent.streamVNext([
      { role: "user", content: "Say hello in two words" },
    ] as any);
    // prefer the promise shape returned by AI SDK-compatible wrappers
    const text =
      typeof res?.text?.then === "function" ? await res.text : undefined;
    // Give the logger a breath to flush async logs tied to res.text
    await new Promise((r) => setTimeout(r, 100));

    let spans = (await testLogger.drain()) as any[];
    let wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "demoAgent.streamVNext" &&
        typeof s?.output === "string",
    );
    if (!wrapperSpan) {
      await new Promise((r) => setTimeout(r, 100));
      spans = (await testLogger.drain()) as any[];
      wrapperSpan = spans.find(
        (s) =>
          s?.span_attributes?.name === "demoAgent.streamVNext" &&
          typeof s?.output === "string",
      );
    }
    expect(wrapperSpan).toBeTruthy();
    if (text) {
      expect(wrapperSpan.output).toBe(text);
    }
    expect(typeof wrapperSpan.metrics?.time_to_first_token).toBe("number");
  });
});
