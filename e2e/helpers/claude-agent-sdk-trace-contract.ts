import { expect } from "vitest";
import { resolveFileSnapshotPath } from "./file-snapshot";
import { normalizeForSnapshot, type Json } from "./normalize";
import type { CapturedLogEvent } from "./mock-braintrust-server";
import {
  findAllSpans,
  findChildSpans,
  findLatestSpan,
} from "./trace-selectors";
import { summarizeWrapperContract } from "./wrapper-contract";

const SNAPSHOT_METADATA_KEYS = [
  "provider",
  "model",
  "operation",
  "scenario",
  "mcp.server",
  "gen_ai.tool.name",
] as const;
const OMITTED_METRIC_KEYS = new Set([
  "prompt_cached_tokens",
  "prompt_cache_creation_tokens",
]);
const SNAPSHOT_ROOT_NAME = "claude-agent-sdk-root";
const SNAPSHOT_SCENARIO_NAME = "claude-agent-sdk-traces";

export function resolveClaudeAgentSDKSpanSnapshotPath(
  dependencyName: string,
): string {
  return resolveFileSnapshotPath(
    import.meta.url,
    `${dependencyName}.claude-agent-sdk.span-events.json`,
  );
}

function summarizeSpan(
  event: CapturedLogEvent | undefined,
  overrides?: {
    metadata?: Json;
    name?: string | null;
  },
): Json {
  if (!event) {
    return null;
  }

  const summary = summarizeWrapperContract(event, [
    ...SNAPSHOT_METADATA_KEYS,
  ]) as Record<string, Json>;
  const metricKeys = Array.isArray(summary.metric_keys)
    ? summary.metric_keys.filter(
        (key): key is string =>
          typeof key === "string" && !OMITTED_METRIC_KEYS.has(key),
      )
    : summary.metric_keys;
  const input = event.input as
    | Array<{ content?: string; message?: { content?: string } }>
    | undefined;
  const inputContents =
    Array.isArray(input) &&
    input
      .map((item) => item.message?.content ?? item.content)
      .filter((content): content is string => typeof content === "string");

  if (overrides?.metadata !== undefined) {
    summary.metadata = overrides.metadata;
  }
  if (overrides?.name !== undefined) {
    summary.name = overrides.name;
  }
  if (typeof event.row.error === "string") {
    summary.error = event.row.error;
  }
  if (metricKeys !== undefined) {
    summary.metric_keys = metricKeys;
  }
  if (Array.isArray(inputContents) && inputContents.length > 0) {
    summary.input_contents = inputContents;
  }

  return summary;
}

export function assertClaudeAgentSDKTraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  rootName: string;
  scenarioName: string;
}): {
  refs: {
    asyncPromptOperation: CapturedLogEvent | undefined;
    asyncPromptLlm: CapturedLogEvent | undefined;
    asyncPromptTask: CapturedLogEvent | undefined;
    basicOperation: CapturedLogEvent | undefined;
    basicLlm: CapturedLogEvent | undefined;
    basicTask: CapturedLogEvent | undefined;
    basicTool: CapturedLogEvent | undefined;
    failureOperation: CapturedLogEvent | undefined;
    failureLlm: CapturedLogEvent | undefined;
    failureTask: CapturedLogEvent | undefined;
    failureTool: CapturedLogEvent | undefined;
    root: CapturedLogEvent | undefined;
    subAgentOperation: CapturedLogEvent | undefined;
    subAgentLlm: CapturedLogEvent | undefined;
    subAgentTask: CapturedLogEvent | undefined;
    subAgentTaskRoot: CapturedLogEvent | undefined;
    subAgentTool: CapturedLogEvent | undefined;
  };
  spanSummary: Json;
} {
  const root = findLatestSpan(options.capturedEvents, options.rootName);
  const basicOperation = findLatestSpan(
    options.capturedEvents,
    "claude-agent-basic-operation",
  );
  const asyncPromptOperation = findLatestSpan(
    options.capturedEvents,
    "claude-agent-async-prompt-operation",
  );
  const subAgentOperation = findLatestSpan(
    options.capturedEvents,
    "claude-agent-subagent-operation",
  );
  const failureOperation = findLatestSpan(
    options.capturedEvents,
    "claude-agent-failure-operation",
  );

  expect(root).toBeDefined();
  expect(root?.row.metadata).toMatchObject({
    scenario: options.scenarioName,
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

  const basicTask = findChildSpans(
    options.capturedEvents,
    "Claude Agent",
    basicOperation?.span.id,
  ).at(-1);
  const asyncPromptTask = findChildSpans(
    options.capturedEvents,
    "Claude Agent",
    asyncPromptOperation?.span.id,
  ).at(-1);
  const subAgentTaskRoot = findChildSpans(
    options.capturedEvents,
    "Claude Agent",
    subAgentOperation?.span.id,
  ).at(-1);
  const failureTask = findChildSpans(
    options.capturedEvents,
    "Claude Agent",
    failureOperation?.span.id,
  ).at(-1);

  expect(basicTask).toBeDefined();
  expect(asyncPromptTask).toBeDefined();
  expect(subAgentTaskRoot).toBeDefined();
  expect(failureTask).toBeDefined();

  const basicLlm = findChildSpans(
    options.capturedEvents,
    "anthropic.messages.create",
    basicTask?.span.id,
  ).at(-1);
  const asyncPromptLlm = findChildSpans(
    options.capturedEvents,
    "anthropic.messages.create",
    asyncPromptTask?.span.id,
  ).find((event) => {
    const input = event.input as Array<{ content?: string }> | undefined;
    return Array.isArray(input) && input.some((item) => item.content);
  });
  const subAgentLlm = findAllSpans(
    options.capturedEvents,
    "anthropic.messages.create",
  ).find((event) =>
    event.span.parentIds.includes(subAgentTaskRoot?.span.id ?? ""),
  );
  const failureLlm = findChildSpans(
    options.capturedEvents,
    "anthropic.messages.create",
    failureTask?.span.id,
  ).at(-1);

  expect(basicLlm).toBeDefined();
  expect(subAgentLlm).toBeDefined();
  expect(failureLlm).toBeDefined();

  if (asyncPromptLlm) {
    const asyncPromptLlmInput = asyncPromptLlm.input as
      | Array<{ content?: string }>
      | undefined;
    expect(asyncPromptLlmInput?.map((item) => item.content)).toEqual([
      "Part 1",
      "Part 2",
    ]);
  }

  const basicTool = findAllSpans(
    options.capturedEvents,
    "tool: calculator/calculator",
  ).find((event) => event.span.parentIds.includes(basicTask?.span.id ?? ""));

  const subAgentTask = options.capturedEvents.find(
    (event) =>
      event.span.type === "task" &&
      event.span.parentIds.includes(subAgentTaskRoot?.span.id ?? "") &&
      event.span.name?.startsWith("Agent:"),
  );
  const subAgentTool = findAllSpans(
    options.capturedEvents,
    "tool: calculator/calculator",
  ).find((event) => event.span.parentIds.includes(subAgentTask?.span.id ?? ""));
  const failureTool = findAllSpans(
    options.capturedEvents,
    "tool: calculator/calculator",
  ).find((event) => event.span.parentIds.includes(failureTask?.span.id ?? ""));

  if (subAgentTool && subAgentTaskRoot) {
    expect(subAgentTool.span.parentIds).not.toContain(subAgentTaskRoot.span.id);
  }

  if (failureTool) {
    expect(failureTool.row.error).toBe("division by zero");
  }

  return {
    refs: {
      asyncPromptOperation,
      asyncPromptLlm,
      asyncPromptTask,
      basicOperation,
      basicLlm,
      basicTask,
      basicTool,
      failureOperation,
      failureLlm,
      failureTask,
      failureTool,
      root,
      subAgentOperation,
      subAgentLlm,
      subAgentTask,
      subAgentTaskRoot,
      subAgentTool,
    },
    spanSummary: normalizeForSnapshot({
      async_prompt: {
        llm: summarizeSpan(asyncPromptLlm),
        operation: summarizeSpan(asyncPromptOperation),
        task: summarizeSpan(asyncPromptTask),
      },
      basic: {
        llm: summarizeSpan(basicLlm),
        operation: summarizeSpan(basicOperation),
        task: summarizeSpan(basicTask),
        tool: summarizeSpan(basicTool),
      },
      failure: {
        llm: summarizeSpan(failureLlm),
        operation: summarizeSpan(failureOperation),
        task: summarizeSpan(failureTask),
        tool: summarizeSpan(failureTool),
      },
      root: summarizeSpan(root, {
        metadata: { scenario: SNAPSHOT_SCENARIO_NAME },
        name: SNAPSHOT_ROOT_NAME,
      }),
      subagent: {
        llm: summarizeSpan(subAgentLlm),
        nested_task: summarizeSpan(subAgentTask),
        operation: summarizeSpan(subAgentOperation),
        task_root: summarizeSpan(subAgentTaskRoot),
        tool: summarizeSpan(subAgentTool),
      },
    } as Json),
  };
}
