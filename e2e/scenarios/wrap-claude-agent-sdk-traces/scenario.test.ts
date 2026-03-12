import { beforeAll, expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  installScenarioDependencies,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import {
  findAllSpans,
  findChildSpans,
  findLatestChildSpan,
  findLatestSpan,
} from "../../helpers/trace-selectors";
import { summarizeWrapperContract } from "../../helpers/wrapper-contract";

const scenarioDir = resolveScenarioDir(import.meta.url);
const TIMEOUT_MS = 120_000;

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

test(
  "wrap-claude-agent-sdk-traces captures tool, async prompt, and subagent traces",
  async () => {
    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const capturedEvents = events();
      const root = findLatestSpan(
        capturedEvents,
        "claude-agent-sdk-wrapper-root",
      );
      const basicOperation = findLatestSpan(
        capturedEvents,
        "claude-agent-basic-operation",
      );
      const asyncPromptOperation = findLatestSpan(
        capturedEvents,
        "claude-agent-async-prompt-operation",
      );
      const subAgentOperation = findLatestSpan(
        capturedEvents,
        "claude-agent-subagent-operation",
      );
      const failureOperation = findLatestSpan(
        capturedEvents,
        "claude-agent-failure-operation",
      );

      expect(root).toBeDefined();
      expect(root?.row.metadata).toMatchObject({
        scenario: "wrap-claude-agent-sdk-traces",
      });

      for (const operation of [
        basicOperation,
        asyncPromptOperation,
        subAgentOperation,
        failureOperation,
      ]) {
        expect(operation).toBeDefined();
        expect(operation?.span.parentIds).toEqual([root?.span.id ?? ""]);
      }

      const basicTask = findLatestChildSpan(
        capturedEvents,
        "Claude Agent",
        basicOperation?.span.id,
      );
      const asyncPromptTask = findLatestChildSpan(
        capturedEvents,
        "Claude Agent",
        asyncPromptOperation?.span.id,
      );
      const subAgentTaskRoot = findLatestChildSpan(
        capturedEvents,
        "Claude Agent",
        subAgentOperation?.span.id,
      );
      const failureTask = findLatestChildSpan(
        capturedEvents,
        "Claude Agent",
        failureOperation?.span.id,
      );

      expect(basicTask).toBeDefined();
      expect(asyncPromptTask).toBeDefined();
      expect(subAgentTaskRoot).toBeDefined();
      expect(failureTask).toBeDefined();

      const basicLlmSpans = findChildSpans(
        capturedEvents,
        "anthropic.messages.create",
        basicTask?.span.id,
      );
      expect(basicLlmSpans.length).toBeGreaterThanOrEqual(1);

      const basicToolSpans = findAllSpans(
        capturedEvents,
        "tool: calculator/calculator",
      ).filter((event) => event.span.rootId === basicTask?.span.rootId);
      expect(basicToolSpans.length).toBeGreaterThanOrEqual(1);

      const asyncPromptInput = asyncPromptTask?.input as Array<{
        message?: { content?: string };
      }>;
      expect(Array.isArray(asyncPromptInput)).toBe(true);
      expect(asyncPromptInput.map((item) => item.message?.content)).toEqual([
        "Part 1",
        "Part 2",
      ]);

      const asyncPromptLlm = findChildSpans(
        capturedEvents,
        "anthropic.messages.create",
        asyncPromptTask?.span.id,
      ).find((event) => {
        const input = event.input as Array<{ content?: unknown }> | undefined;
        return Array.isArray(input) && input.some((item) => item.content);
      });
      expect(asyncPromptLlm).toBeDefined();
      const asyncPromptLlmInput = asyncPromptLlm?.input as Array<{
        content?: string;
      }>;
      expect(asyncPromptLlmInput.map((item) => item.content)).toEqual([
        "Part 1",
        "Part 2",
      ]);

      const subAgentTask = events().find(
        (event) =>
          event.span.type === "task" &&
          event.span.rootId === subAgentTaskRoot?.span.rootId &&
          event.span.parentIds.includes(subAgentTaskRoot?.span.id ?? "") &&
          event.span.name?.startsWith("Agent:"),
      );
      expect(subAgentTask).toBeDefined();

      const subAgentLlmSpans = findAllSpans(
        capturedEvents,
        "anthropic.messages.create",
      ).filter((event) =>
        event.span.parentIds.includes(subAgentTask?.span.id ?? ""),
      );
      expect(subAgentLlmSpans.length).toBeGreaterThanOrEqual(1);

      const subAgentToolSpans = findAllSpans(
        capturedEvents,
        "tool: calculator/calculator",
      ).filter((event) =>
        event.span.parentIds.includes(subAgentTask?.span.id ?? ""),
      );
      expect(subAgentToolSpans.length).toBeGreaterThanOrEqual(1);
      for (const toolSpan of subAgentToolSpans) {
        expect(toolSpan.span.parentIds).not.toContain(
          subAgentTaskRoot?.span.id,
        );
      }

      const failureToolSpan = findAllSpans(
        capturedEvents,
        "tool: calculator/calculator",
      ).find(
        (event) =>
          event.span.rootId === failureTask?.span.rootId &&
          event.span.parentIds.includes(failureTask?.span.id ?? ""),
      );
      expect(failureToolSpan).toBeDefined();
      expect(failureToolSpan?.row.error).toBe("division by zero");

      expect(
        normalizeForSnapshot(
          [
            root,
            basicOperation,
            basicTask,
            basicLlmSpans[0],
            basicToolSpans[0],
            asyncPromptOperation,
            asyncPromptTask,
            asyncPromptLlm,
            subAgentOperation,
            subAgentTaskRoot,
            subAgentTask,
            subAgentLlmSpans[0],
            subAgentToolSpans[0],
            failureOperation,
            failureTask,
            failureToolSpan,
          ].map((event) =>
            summarizeWrapperContract(event!, [
              "provider",
              "model",
              "operation",
              "scenario",
              "mcp.server",
              "gen_ai.tool.name",
            ]),
          ) as Json,
        ),
      ).toMatchSnapshot();
    });
  },
  TIMEOUT_MS,
);
