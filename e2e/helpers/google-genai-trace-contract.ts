import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type {
  CapturedLogEvent,
  CapturedLogPayload,
  CapturedLogRow,
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

function normalizeGooglePayloads(payloadRows: unknown[]): unknown[] {
  return payloadRows.map((payload) => {
    if (!payload || typeof payload !== "object") {
      return payload;
    }

    const row = structuredClone(payload) as {
      output?: {
        usageMetadata?: {
          promptTokensDetails?: Array<{ modality?: string }>;
        };
      };
    };
    const promptTokensDetails = row.output?.usageMetadata?.promptTokensDetails;
    if (promptTokensDetails) {
      promptTokensDetails.sort((left, right) =>
        String(left.modality ?? "").localeCompare(String(right.modality ?? "")),
      );
    }
    return row;
  });
}

function normalizeGoogleSnapshotSummary(options: {
  event: CapturedLogEvent;
  metadataKeys: string[];
  rootSpanId: string | undefined;
  rootName: string;
  snapshotRootName?: string;
  snapshotScenarioName?: string;
}): Json {
  const summary = summarizeWrapperContract(
    options.event,
    options.metadataKeys,
  ) as
    | {
        metadata?: Record<string, unknown> | null;
        name?: string | null;
      }
    | Json;

  if (
    options.event.span.id === options.rootSpanId &&
    summary &&
    typeof summary === "object" &&
    !Array.isArray(summary)
  ) {
    if (options.snapshotRootName && summary.name === options.rootName) {
      summary.name = options.snapshotRootName;
    }

    if (
      options.snapshotScenarioName &&
      summary.metadata &&
      typeof summary.metadata === "object" &&
      !Array.isArray(summary.metadata)
    ) {
      summary.metadata = {
        ...summary.metadata,
        scenario: options.snapshotScenarioName,
      };
    }
  }

  return summary as Json;
}

function normalizeGoogleSnapshotPayloadRows(options: {
  payloadRows: CapturedLogRow[];
  rootSpanId: string | undefined;
  snapshotRootName?: string;
  snapshotScenarioName?: string;
}): CapturedLogRow[] {
  return options.payloadRows.map((row) => {
    if (row.span_id !== options.rootSpanId) {
      return row;
    }

    const normalizedRow = structuredClone(row);

    if (
      options.snapshotScenarioName &&
      normalizedRow.metadata &&
      typeof normalizedRow.metadata === "object" &&
      !Array.isArray(normalizedRow.metadata)
    ) {
      normalizedRow.metadata = {
        ...normalizedRow.metadata,
        scenario: options.snapshotScenarioName,
      };
    }

    if (
      options.snapshotRootName &&
      normalizedRow.span_attributes &&
      typeof normalizedRow.span_attributes === "object" &&
      !Array.isArray(normalizedRow.span_attributes)
    ) {
      normalizedRow.span_attributes = {
        ...normalizedRow.span_attributes,
        name: options.snapshotRootName,
      };
    }

    return normalizedRow;
  });
}

export function assertGoogleGenAITraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  payloads: CapturedLogPayload[];
  rootName: string;
  scenarioName: string;
  snapshotRootName?: string;
  snapshotScenarioName?: string;
}): { payloadSummary: Json; spanSummary: Json } {
  const root = findLatestSpan(options.capturedEvents, options.rootName);
  const generateOperation = findLatestSpan(
    options.capturedEvents,
    "google-generate-operation",
  );
  const streamOperation = findLatestSpan(
    options.capturedEvents,
    "google-stream-operation",
  );
  const streamReturnOperation = findLatestSpan(
    options.capturedEvents,
    "google-stream-return-operation",
  );
  const toolOperation = findLatestSpan(
    options.capturedEvents,
    "google-tool-operation",
  );
  const attachmentOperation = findLatestSpan(
    options.capturedEvents,
    "google-attachment-operation",
  );

  expect(root).toBeDefined();
  expect(generateOperation).toBeDefined();
  expect(streamOperation).toBeDefined();
  expect(streamReturnOperation).toBeDefined();
  expect(toolOperation).toBeDefined();
  expect(attachmentOperation).toBeDefined();

  expect(root?.row.metadata).toMatchObject({
    scenario: options.scenarioName,
  });
  expect(generateOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(streamReturnOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  expect(attachmentOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

  const generateSpan = findNamedChildSpan(
    options.capturedEvents,
    ["generate_content", "google-genai.generateContent"],
    generateOperation?.span.id,
  );
  const streamSpan = findNamedChildSpan(
    options.capturedEvents,
    ["generate_content_stream", "google-genai.generateContentStream"],
    streamOperation?.span.id,
  );
  const streamReturnSpan = findNamedChildSpan(
    options.capturedEvents,
    ["generate_content_stream", "google-genai.generateContentStream"],
    streamReturnOperation?.span.id,
  );
  const toolSpan = findNamedChildSpan(
    options.capturedEvents,
    ["generate_content", "google-genai.generateContent"],
    toolOperation?.span.id,
  );
  const attachmentSpan = findNamedChildSpan(
    options.capturedEvents,
    ["generate_content", "google-genai.generateContent"],
    attachmentOperation?.span.id,
  );

  for (const wrapperSpan of [
    generateSpan,
    streamSpan,
    streamReturnSpan,
    toolSpan,
    attachmentSpan,
  ]) {
    expect(wrapperSpan).toBeDefined();
    expect(wrapperSpan?.row.metadata).toMatchObject({
      model: "gemini-2.5-flash-lite",
    });
  }

  expect(streamSpan?.metrics).toMatchObject({
    time_to_first_token: expect.any(Number),
    prompt_tokens: expect.any(Number),
    completion_tokens: expect.any(Number),
  });
  expect(streamReturnSpan?.metrics).toMatchObject({
    time_to_first_token: expect.any(Number),
    prompt_tokens: expect.any(Number),
  });

  expect(JSON.stringify(attachmentSpan?.input)).toContain("file.png");

  const toolMetadata = toolSpan?.row.metadata as
    | {
        tools?: Array<{
          functionDeclarations?: Array<{ name?: string }>;
        }>;
      }
    | undefined;
  expect(
    toolMetadata?.tools?.some((tool) =>
      tool.functionDeclarations?.some(
        (declaration) => declaration.name === "get_weather",
      ),
    ) || JSON.stringify(toolSpan?.input).includes("get_weather"),
  ).toBe(true);

  const toolInput = toolSpan?.input as
    | {
        config?: {
          tools?: Array<unknown>;
        };
      }
    | undefined;
  expect(
    toolInput?.config?.tools === undefined ||
      JSON.stringify(toolInput.config.tools).includes("get_weather"),
  ).toBe(true);

  const toolOutput = toolSpan?.output as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              functionCall?: { name?: string };
            }>;
          };
        }>;
        functionCalls?: Array<{ name?: string }>;
      }
    | undefined;
  expect(
    toolOutput?.functionCalls?.some((call) => call.name === "get_weather") ||
      toolOutput?.candidates?.some((candidate) =>
        candidate.content?.parts?.some(
          (part) => part.functionCall?.name === "get_weather",
        ),
      ),
  ).toBe(true);

  return {
    spanSummary: normalizeForSnapshot(
      [
        root,
        generateOperation,
        generateSpan,
        attachmentOperation,
        attachmentSpan,
        streamOperation,
        streamSpan,
        streamReturnOperation,
        streamReturnSpan,
        toolOperation,
        toolSpan,
      ].map((event) =>
        normalizeGoogleSnapshotSummary({
          event: event!,
          metadataKeys: ["model", "operation", "scenario"],
          rootName: options.rootName,
          rootSpanId: root?.span.id,
          snapshotRootName: options.snapshotRootName,
          snapshotScenarioName: options.snapshotScenarioName,
        }),
      ) as Json,
    ),
    payloadSummary: normalizeForSnapshot(
      normalizeGooglePayloads(
        normalizeGoogleSnapshotPayloadRows({
          payloadRows: payloadRowsForRootSpan(options.payloads, root?.span.id),
          rootSpanId: root?.span.id,
          snapshotRootName: options.snapshotRootName,
          snapshotScenarioName: options.snapshotScenarioName,
        }),
      ) as Json,
    ),
  };
}
