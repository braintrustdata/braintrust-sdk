import { expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import { assertClaudeAgentSDKTraceContract } from "../../helpers/claude-agent-sdk-trace-contract";
import {
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";
import {
  findAllSpans,
  findChildSpans,
  findLatestSpan,
} from "../../helpers/trace-selectors";
import { summarizeWrapperContract } from "../../helpers/wrapper-contract";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 120_000;

test(
  "wrap-claude-agent-sdk-traces captures tool, async prompt, and subagent traces",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const capturedEvents = events();
      const contract = assertClaudeAgentSDKTraceContract({
        capturedEvents,
        rootName: "claude-agent-sdk-wrapper-root",
        scenarioName: "wrap-claude-agent-sdk-traces",
      });
      const root = contract.refs.root;
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
      const basicTask = contract.refs.basicTask;
      const asyncPromptTask = contract.refs.asyncPromptTask;
      const subAgentTaskRoot = contract.refs.subAgentTaskRoot;
      const failureTask = contract.refs.failureTask;
      const asyncPromptLlm = contract.refs.asyncPromptLlm;

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
);
