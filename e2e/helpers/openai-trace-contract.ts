import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type { CapturedLogEvent } from "./mock-braintrust-server";
import { summarizeOpenAIContract } from "./openai";
import { findChildSpans, findLatestSpan } from "./trace-selectors";

const OPERATIONS = [
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-chat-operation",
    operation: "chat",
  },
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-chat-with-response-operation",
    operation: "chat-with-response",
  },
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-stream-operation",
    operation: "stream",
  },
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-stream-with-response-operation",
    operation: "stream-with-response",
  },
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-parse-operation",
    operation: "parse",
  },
  {
    childNames: ["Chat Completion"],
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-sync-stream-operation",
    operation: "sync-stream",
  },
  {
    childNames: ["Embedding"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-embeddings-operation",
    operation: "embeddings",
  },
  {
    childNames: ["Moderation"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-moderations-operation",
    operation: "moderations",
  },
  {
    childNames: ["openai.responses.create"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-responses-operation",
    operation: "responses",
  },
  {
    childNames: ["openai.responses.create"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-responses-with-response-operation",
    operation: "responses-with-response",
  },
  {
    childNames: ["openai.responses.create"],
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-responses-create-stream-operation",
    operation: "responses-create-stream",
  },
  {
    childNames: ["openai.responses.create"],
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-responses-stream-operation",
    operation: "responses-stream",
  },
  {
    childNames: ["openai.responses.create"],
    expectsOutput: false,
    expectsTimeToFirstToken: true,
    name: "openai-responses-stream-partial-operation",
    operation: "responses-stream-partial",
  },
  {
    childNames: ["openai.responses.parse", "openai.responses.create"],
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openai-responses-parse-operation",
    operation: "responses-parse",
  },
] as const;

function findSingleChildForOperation(
  capturedEvents: CapturedLogEvent[],
  childNames: readonly string[],
  parentId: string | undefined,
) {
  for (const childName of childNames) {
    const children = findChildSpans(capturedEvents, childName, parentId);
    if (children.length > 0) {
      return children;
    }
  }

  return [];
}

export function assertOpenAITraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  rootName: string;
  scenarioName: string;
  version: string;
}): { spanSummary: Json } {
  const root = findLatestSpan(options.capturedEvents, options.rootName);

  expect(root).toBeDefined();
  expect(root?.row.metadata).toMatchObject({
    openaiSdkVersion: options.version,
    scenario: options.scenarioName,
  });

  const snapshotRows = [root];

  for (const operationSpec of OPERATIONS) {
    const operation = findLatestSpan(
      options.capturedEvents,
      operationSpec.name,
    );
    expect(operation).toBeDefined();
    expect(operation?.row.metadata).toMatchObject({
      operation: operationSpec.operation,
    });
    expect(operation?.span.parentIds).toEqual([root?.span.id ?? ""]);

    const children = findSingleChildForOperation(
      options.capturedEvents,
      operationSpec.childNames,
      operation?.span.id,
    );

    expect(children.length).toBeGreaterThanOrEqual(1);
    const child =
      children.find((candidate) => candidate.output !== undefined) ??
      children.at(-1);
    snapshotRows.push(operation, child);

    expect(child?.row.metadata).toMatchObject({
      provider: "openai",
    });
    expect(
      typeof (child?.row.metadata as { model?: unknown } | undefined)?.model,
    ).toBe("string");

    if (operationSpec.expectsOutput) {
      expect(child?.output).toBeDefined();
    }

    if (operationSpec.expectsTimeToFirstToken) {
      expect(child?.metrics?.time_to_first_token).toEqual(expect.any(Number));
    }
  }

  return {
    spanSummary: normalizeForSnapshot(
      snapshotRows.map((event) => summarizeOpenAIContract(event!)) as Json,
    ),
  };
}
