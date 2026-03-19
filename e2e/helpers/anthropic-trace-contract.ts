import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type {
  CapturedLogEvent,
  CapturedLogPayload,
} from "./mock-braintrust-server";
import { findChildSpans, findLatestSpan } from "./trace-selectors";
import {
  payloadRowsForRootSpan,
  summarizeWrapperContract,
} from "./wrapper-contract";

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

function normalizeAnthropicPayloads(payloadRows: unknown[]): unknown[] {
  const attachmentRowKeys = new Set<string>();

  for (const payload of payloadRows) {
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const row = payload as {
      id?: string;
      input?: Array<{
        content?:
          | string
          | Array<{
              source?: {
                data?: {
                  type?: string;
                };
              };
            }>;
      }>;
      span_id?: string;
    };

    const hasAttachmentInput = row.input?.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (block) => block.source?.data?.type === "braintrust_attachment",
        ),
    );

    if (!hasAttachmentInput) {
      continue;
    }

    if (typeof row.id === "string") {
      attachmentRowKeys.add(row.id);
    }
    if (typeof row.span_id === "string") {
      attachmentRowKeys.add(row.span_id);
    }
  }

  return payloadRows.map((payload) => {
    if (!payload || typeof payload !== "object") {
      return payload;
    }

    const row = structuredClone(payload) as {
      id?: string;
      metadata?: { operation?: string };
      output?: {
        content?: Array<{ text?: string; type?: string }>;
      };
      span_id?: string;
    };
    const isAttachmentRow =
      row.metadata?.operation === "attachment" ||
      (typeof row.id === "string" && attachmentRowKeys.has(row.id)) ||
      (typeof row.span_id === "string" && attachmentRowKeys.has(row.span_id));

    if (isAttachmentRow) {
      const textBlock = row.output?.content?.find(
        (block) => block.type === "text" && typeof block.text === "string",
      );
      if (textBlock) {
        textBlock.text = "<anthropic-attachment-description>";
      }
    }

    return row;
  });
}

export function assertAnthropicTraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  payloads: CapturedLogPayload[];
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

  for (const streamingSpan of [streamSpan, withResponseSpan, betaStreamSpan]) {
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
      normalizeAnthropicPayloads(
        payloadRowsForRootSpan(options.payloads, root?.span.id),
      ) as Json,
    ),
  };
}
