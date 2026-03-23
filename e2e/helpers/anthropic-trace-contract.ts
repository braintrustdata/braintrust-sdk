import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type { CapturedLogEvent } from "./mock-braintrust-server";
import { findChildSpans, findLatestSpan } from "./trace-selectors";
import { summarizeWrapperContract } from "./wrapper-contract";

function findNamedChildSpan(
  capturedEvents: CapturedLogEvent[],
  names: string[],
  parentId: string | undefined,
) {
  for (const name of names) {
    const span = findChildSpans(capturedEvents, name, parentId)[0];
    if (span) {
      return span;
    }
  }

  return undefined;
}

function pickMetadata(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): Json {
  if (!metadata) {
    return null;
  }

  const picked = Object.fromEntries(
    keys.flatMap((key) =>
      key in metadata ? [[key, metadata[key] as Json]] : [],
    ),
  );

  return Object.keys(picked).length > 0 ? (picked as Json) : null;
}

function summarizeAnthropicPayloadEvent(
  event: CapturedLogEvent,
  metadataKeys: string[],
): Json {
  const summary = {
    input: event.input as Json,
    metadata: pickMetadata(
      event.row.metadata as Record<string, unknown> | undefined,
      metadataKeys,
    ),
    metrics: event.metrics as Json,
    name: event.span.name ?? null,
    output: event.output as Json,
    type: event.span.type ?? null,
  } satisfies Json;

  if (
    event.span.name === "anthropic.messages.create" &&
    Array.isArray((summary.output as { content?: unknown[] } | null)?.content)
  ) {
    const output = structuredClone(
      summary.output as {
        content: Array<{ text?: string; type?: string }>;
      },
    );
    const textBlock = output.content.find(
      (block) => block.type === "text" && typeof block.text === "string",
    );
    const input = event.input as
      | Array<{
          content?:
            | string
            | Array<{
                source?: {
                  data?: {
                    type?: string;
                  };
                };
              }>;
        }>
      | undefined;
    const hasAttachmentInput = input?.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (block) => block.source?.data?.type === "braintrust_attachment",
        ),
    );

    if (hasAttachmentInput && textBlock) {
      textBlock.text = "<anthropic-attachment-description>";
      summary.output = output as Json;
    }
  }

  return summary;
}

export function assertAnthropicTraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  rootName: string;
  scenarioName: string;
}): { payloadSummary: Json; spanSummary: Json } {
  const root = findLatestSpan(options.capturedEvents, options.rootName);
  const createOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-create-operation",
  );
  const streamOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-stream-operation",
  );
  const withResponseOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-stream-with-response-operation",
  );
  const toolStreamOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-stream-tool-operation",
  );
  const toolOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-tool-operation",
  );
  const attachmentOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-attachment-operation",
  );
  const betaCreateOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-beta-create-operation",
  );
  const betaStreamOperation = findLatestSpan(
    options.capturedEvents,
    "anthropic-beta-stream-operation",
  );

  expect(root).toBeDefined();
  expect(createOperation).toBeDefined();
  expect(streamOperation).toBeDefined();
  expect(withResponseOperation).toBeDefined();
  expect(toolStreamOperation).toBeDefined();
  expect(toolOperation).toBeDefined();
  expect(attachmentOperation).toBeDefined();
  expect(betaCreateOperation).toBeDefined();
  expect(betaStreamOperation).toBeDefined();

  expect(root?.row.metadata).toMatchObject({
    scenario: options.scenarioName,
  });
  expect(createOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(withResponseOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(toolStreamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(attachmentOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(betaCreateOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(betaStreamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

  const createSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    createOperation?.span.id,
  );
  const streamSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    streamOperation?.span.id,
  );
  const withResponseSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    withResponseOperation?.span.id,
  );
  const toolSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    toolOperation?.span.id,
  );
  const toolStreamSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    toolStreamOperation?.span.id,
  );
  const attachmentSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create"],
    attachmentOperation?.span.id,
  );
  const betaCreateSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create", "anthropic.beta.messages.create"],
    betaCreateOperation?.span.id,
  );
  const betaStreamSpan = findNamedChildSpan(
    options.capturedEvents,
    ["anthropic.messages.create", "anthropic.beta.messages.create"],
    betaStreamOperation?.span.id,
  );

  for (const wrapperSpan of [
    createSpan,
    streamSpan,
    withResponseSpan,
    toolStreamSpan,
    toolSpan,
    attachmentSpan,
    betaCreateSpan,
    betaStreamSpan,
  ]) {
    expect(wrapperSpan).toBeDefined();
    expect(wrapperSpan?.row.metadata).toMatchObject({
      provider: "anthropic",
    });
    expect(
      typeof (wrapperSpan?.row.metadata as { model?: unknown } | undefined)
        ?.model,
    ).toBe("string");
  }

  for (const streamingSpan of [
    streamSpan,
    withResponseSpan,
    toolStreamSpan,
    betaStreamSpan,
  ]) {
    expect(streamingSpan?.metrics).toMatchObject({
      time_to_first_token: expect.any(Number),
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
    });
  }

  const toolOutput = toolSpan?.output as
    | {
        content?: Array<{ name?: string; type?: string }>;
      }
    | undefined;
  expect(
    toolOutput?.content?.some(
      (block) => block.type === "tool_use" && block.name === "get_weather",
    ),
  ).toBe(true);
  const toolStreamOutput = toolStreamSpan?.output as
    | {
        content?: Array<{ name?: string; type?: string }>;
      }
    | undefined;
  expect(
    toolStreamOutput?.content?.some(
      (block) => block.type === "tool_use" && block.name === "get_weather",
    ),
  ).toBe(true);

  const attachmentInput = JSON.stringify(attachmentSpan?.input);
  expect(attachmentInput).toContain("image.png");

  return {
    spanSummary: normalizeForSnapshot(
      [
        root,
        createOperation,
        createSpan,
        attachmentOperation,
        attachmentSpan,
        streamOperation,
        streamSpan,
        withResponseOperation,
        withResponseSpan,
        toolStreamOperation,
        toolStreamSpan,
        toolOperation,
        toolSpan,
        betaCreateOperation,
        betaCreateSpan,
        betaStreamOperation,
        betaStreamSpan,
      ].map((event) =>
        summarizeWrapperContract(event!, [
          "provider",
          "model",
          "operation",
          "scenario",
        ]),
      ) as Json,
    ),
    payloadSummary: normalizeForSnapshot(
      [
        root,
        createOperation,
        createSpan,
        attachmentOperation,
        attachmentSpan,
        streamOperation,
        streamSpan,
        withResponseOperation,
        withResponseSpan,
        toolStreamOperation,
        toolStreamSpan,
        toolOperation,
        toolSpan,
        betaCreateOperation,
        betaCreateSpan,
        betaStreamOperation,
        betaStreamSpan,
      ].map((event) =>
        summarizeAnthropicPayloadEvent(event!, [
          "provider",
          "model",
          "operation",
          "scenario",
          "stop_reason",
          "stop_sequence",
        ]),
      ) as Json,
    ),
  };
}
