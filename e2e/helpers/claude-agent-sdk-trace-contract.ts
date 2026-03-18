import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type { CapturedLogEvent } from "./mock-braintrust-server";
import {
  findAllSpans,
  findChildSpans,
  findLatestSpan,
} from "./trace-selectors";
import { summarizeWrapperContract } from "./wrapper-contract";

export function assertClaudeAgentSDKTraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  rootName: string;
  scenarioName: string;
}): {
  refs: {
    asyncPromptLlm: CapturedLogEvent | undefined;
    asyncPromptTask: CapturedLogEvent | undefined;
    basicLlm: CapturedLogEvent | undefined;
    basicTask: CapturedLogEvent | undefined;
    failureLlm: CapturedLogEvent | undefined;
    failureTask: CapturedLogEvent | undefined;
    root: CapturedLogEvent | undefined;
    subAgentLlm: CapturedLogEvent | undefined;
    subAgentTaskRoot: CapturedLogEvent | undefined;
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

  return {
    refs: {
      asyncPromptLlm,
      asyncPromptTask,
      basicLlm,
      basicTask,
      failureLlm,
      failureTask,
      root,
      subAgentLlm,
      subAgentTaskRoot,
    },
    spanSummary: normalizeForSnapshot(
      [
        root,
        basicOperation,
        basicTask,
        basicLlm,
        asyncPromptOperation,
        asyncPromptTask,
        asyncPromptLlm,
        subAgentOperation,
        subAgentTaskRoot,
        subAgentLlm,
        failureOperation,
        failureTask,
        failureLlm,
      ]
        .filter((event) => event !== undefined)
        .map((event) =>
          summarizeWrapperContract(event!, [
            "provider",
            "model",
            "operation",
            "scenario",
          ]),
        ) as Json,
    ),
  };
}
