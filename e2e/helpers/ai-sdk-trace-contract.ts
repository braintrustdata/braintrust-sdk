import { expect } from "vitest";
import type {
  CapturedLogEvent,
  CapturedLogPayload,
} from "./mock-braintrust-server";
import { normalizeForSnapshot, type Json } from "./normalize";
import {
  findAllSpans,
  findChildSpans,
  findLatestSpan,
} from "./trace-selectors";
import {
  payloadRowsForRootSpan,
  summarizeWrapperContract,
} from "./wrapper-contract";

export interface AISDKTraceContractOptions {
  agentSpanName?: "Agent" | "ToolLoopAgent";
  capturedEvents: CapturedLogEvent[];
  payloads: CapturedLogPayload[];
  rootName: string;
  scenarioName: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
  supportsToolExecution: boolean;
  version: string;
}

function collectToolCallNames(output: unknown): string[] {
  if (!output || typeof output !== "object") {
    return [];
  }

  const record = output as {
    steps?: Array<{ toolCalls?: Array<{ toolName?: string; name?: string }> }>;
    toolCalls?: Array<{ toolName?: string; name?: string }>;
  };
  const names = [
    ...(record.toolCalls ?? []),
    ...(record.steps ?? []).flatMap((step) => step.toolCalls ?? []),
  ]
    .map((call) => call.toolName ?? call.name)
    .filter((name): name is string => typeof name === "string");

  return [...new Set(names)];
}

function findModelChildren(
  capturedEvents: CapturedLogEvent[],
  parentId: string | undefined,
) {
  return capturedEvents.filter((event) => {
    const name = event.span.name ?? "";
    return (
      event.span.parentIds[0] === parentId &&
      (name === "doGenerate" || name === "doStream")
    );
  });
}

function latestEvent<T>(events: T[]): T | undefined {
  return events.at(-1);
}

function normalizeAISDKAgentGeneratePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAISDKAgentGeneratePayload(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (key === "text" && typeof entry === "string") {
      normalized[key] = "<agent-generate-text>";
      continue;
    }

    if (
      (key === "completionTokens" ||
        key === "completion_tokens" ||
        key === "outputTokens" ||
        key === "tokens" ||
        key === "totalTokens") &&
      typeof entry === "number"
    ) {
      normalized[key] = "<number>";
      continue;
    }

    normalized[key] = normalizeAISDKAgentGeneratePayload(entry);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAISDKModelRef(value: unknown): value is {
  modelId: unknown;
  provider: unknown;
} {
  return (
    isRecord(value) &&
    typeof value.modelId === "string" &&
    typeof value.provider === "string"
  );
}

function normalizeAISDKContext(value: unknown): Record<string, unknown> {
  return {
    ...(isRecord(value) ? value : {}),
    caller_filename: "<caller>",
    caller_functionname: "<caller>",
    caller_lineno: 0,
  };
}

function normalizeAISDKSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAISDKSnapshotValue(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "context") {
      normalized[key] = normalizeAISDKContext(entry);
      continue;
    }

    if (key === "aiSdkVersion") {
      normalized[key] = "<ai-sdk-version>";
      continue;
    }

    if (
      key === "user-agent" &&
      typeof entry === "string" &&
      entry.startsWith("ai/")
    ) {
      normalized[key] = "ai/<version>";
      continue;
    }

    if (key === "stepNumber") {
      continue;
    }

    if (key === "model" && isAISDKModelRef(entry)) {
      continue;
    }

    normalized[key] = normalizeAISDKSnapshotValue(entry);
  }

  return normalized;
}

function normalizeAISDKPayloads(payloadRows: unknown[]): unknown[] {
  return payloadRows.map((payload) => {
    const normalizedPayload =
      isRecord(payload) && payload.metadata?.operation === "agent-generate"
        ? normalizeAISDKAgentGeneratePayload(structuredClone(payload))
        : structuredClone(payload);

    return normalizeAISDKSnapshotValue(normalizedPayload);
  });
}

export function assertAISDKTraceContract(options: AISDKTraceContractOptions): {
  payloadSummary: Json;
  spanSummary: Json;
} {
  const {
    agentSpanName,
    capturedEvents,
    payloads,
    rootName,
    scenarioName,
    supportsGenerateObject,
    supportsStreamObject,
    supportsToolExecution,
    version,
  } = options;

  const root = findLatestSpan(capturedEvents, rootName);
  const generateOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-generate-operation",
  );
  const streamOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-stream-operation",
  );
  const toolOperation = findLatestSpan(capturedEvents, "ai-sdk-tool-operation");
  const generateObjectOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-generate-object-operation",
  );
  const streamObjectOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-stream-object-operation",
  );
  const agentGenerateOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-agent-generate-operation",
  );
  const agentStreamOperation = findLatestSpan(
    capturedEvents,
    "ai-sdk-agent-stream-operation",
  );

  expect(root).toBeDefined();
  expect(root?.row.metadata).toMatchObject({
    aiSdkVersion: version,
    scenario: scenarioName,
  });

  for (const operation of [
    generateOperation,
    streamOperation,
    toolOperation,
    supportsGenerateObject ? generateObjectOperation : undefined,
    supportsStreamObject ? streamObjectOperation : undefined,
    agentSpanName ? agentGenerateOperation : undefined,
    agentSpanName ? agentStreamOperation : undefined,
  ].filter((value) => value !== undefined)) {
    expect(operation?.span.parentIds).toEqual([root?.span.id ?? ""]);
  }

  const generateParent = findChildSpans(
    capturedEvents,
    "generateText",
    generateOperation?.span.id,
  )[0];
  const streamParent = findChildSpans(
    capturedEvents,
    "streamText",
    streamOperation?.span.id,
  )[0];
  const toolParent = findChildSpans(
    capturedEvents,
    "generateText",
    toolOperation?.span.id,
  )[0];
  const generateObjectParent =
    supportsGenerateObject && generateObjectOperation
      ? findChildSpans(
          capturedEvents,
          "generateObject",
          generateObjectOperation.span.id,
        )[0]
      : undefined;
  const streamObjectParent =
    supportsStreamObject && streamObjectOperation
      ? findChildSpans(
          capturedEvents,
          "streamObject",
          streamObjectOperation.span.id,
        )[0]
      : undefined;
  const agentGenerateParent =
    agentSpanName && agentGenerateOperation
      ? findChildSpans(
          capturedEvents,
          `${agentSpanName}.generate`,
          agentGenerateOperation.span.id,
        )[0]
      : undefined;
  const agentStreamParent =
    agentSpanName && agentStreamOperation
      ? findChildSpans(
          capturedEvents,
          `${agentSpanName}.stream`,
          agentStreamOperation.span.id,
        )[0]
      : undefined;

  for (const parent of [
    generateParent,
    streamParent,
    toolParent,
    generateObjectParent,
    streamObjectParent,
    agentGenerateParent,
    agentStreamParent,
  ].filter((value) => value !== undefined)) {
    expect(parent).toBeDefined();
    expect(parent?.row.metadata).toMatchObject({
      braintrust: {
        integration_name: "ai-sdk",
        sdk_language: "typescript",
      },
    });
    expect(
      String(
        (parent?.row.metadata as { provider?: unknown } | undefined)
          ?.provider ?? "",
      ).startsWith("openai"),
    ).toBe(true);
    expect(
      typeof (parent?.row.metadata as { model?: unknown } | undefined)?.model,
    ).toBe("string");
  }

  const generateChild = latestEvent(
    findChildSpans(capturedEvents, "doGenerate", generateParent?.span.id),
  );
  const streamChild = latestEvent(
    findChildSpans(capturedEvents, "doStream", streamParent?.span.id),
  );
  const toolModelSpans = capturedEvents
    .filter((event) => event.span.rootId === toolOperation?.span.rootId)
    .filter((event) => {
      const name = event.span.name ?? "";
      return name === "doGenerate" || name === "doStream";
    })
    .filter((event) => event.span.parentIds[0] !== generateParent?.span.id);
  const toolSpans = findAllSpans(capturedEvents, "get_weather").filter(
    (event) => event.span.rootId === toolOperation?.span.rootId,
  );
  const generateObjectChild =
    generateObjectParent &&
    latestEvent(
      findChildSpans(
        capturedEvents,
        "doGenerate",
        generateObjectParent.span.id,
      ),
    );
  const streamObjectChild =
    streamObjectParent &&
    latestEvent(
      findChildSpans(capturedEvents, "doStream", streamObjectParent.span.id),
    );
  const agentGenerateChildren = agentGenerateParent
    ? findModelChildren(capturedEvents, agentGenerateParent.span.id)
    : [];
  const agentStreamChildren = agentStreamParent
    ? findModelChildren(capturedEvents, agentStreamParent.span.id)
    : [];
  const latestAgentGenerateChild = latestEvent(agentGenerateChildren);
  const latestAgentStreamChild = latestEvent(agentStreamChildren);

  expect(generateChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
  expect(generateChild?.metrics?.completion_tokens).toEqual(expect.any(Number));
  if (generateChild?.metrics?.tokens !== undefined) {
    expect(generateChild.metrics.tokens).toEqual(expect.any(Number));
  }

  expect(streamParent?.metrics?.time_to_first_token).toEqual(
    expect.any(Number),
  );
  expect(streamChild?.output).toBeDefined();
  expect(streamChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
  expect(streamChild?.metrics?.completion_tokens).toEqual(expect.any(Number));
  if (streamChild?.metrics?.tokens !== undefined) {
    expect(streamChild.metrics.tokens).toEqual(expect.any(Number));
  }

  expect(toolParent?.input).toBeDefined();
  expect(toolParent?.output).toBeDefined();
  if (supportsToolExecution) {
    expect(toolModelSpans.length).toBeGreaterThanOrEqual(2);
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    expect(toolSpans[0]?.input).toBeDefined();
    expect(toolSpans[0]?.output).toBeDefined();
  } else {
    expect(toolModelSpans.length).toBeGreaterThanOrEqual(1);
    expect(collectToolCallNames(toolParent?.output)).toContain("get_weather");
  }

  if (supportsGenerateObject) {
    expect(generateObjectOperation).toBeDefined();
    expect(generateObjectParent?.output).toMatchObject({
      object: { city: "Paris" },
    });
    if (generateObjectChild) {
      expect(generateObjectChild.output).toBeDefined();
    }
  } else {
    expect(generateObjectOperation).toBeUndefined();
  }

  if (supportsStreamObject) {
    expect(streamObjectOperation).toBeDefined();
    if (streamObjectParent?.metrics?.time_to_first_token !== undefined) {
      expect(streamObjectParent.metrics.time_to_first_token).toEqual(
        expect.any(Number),
      );
    }
    if (
      (streamObjectParent?.output as { object?: unknown } | undefined)
        ?.object !== undefined
    ) {
      expect(streamObjectParent?.output).toMatchObject({
        object: { city: "Paris" },
      });
    } else {
      expect(streamObjectParent?.output).toBeDefined();
    }
    if (streamObjectChild) {
      expect(streamObjectChild.output).toBeDefined();
    }
  } else {
    expect(streamObjectOperation).toBeUndefined();
  }

  if (agentSpanName) {
    expect(agentGenerateOperation).toBeDefined();
    expect(agentStreamOperation).toBeDefined();
    expect(agentGenerateParent?.output).toBeDefined();
    expect(agentGenerateChildren.length).toBeGreaterThanOrEqual(1);
    expect(agentStreamParent?.metrics?.time_to_first_token).toEqual(
      expect.any(Number),
    );
    expect(agentStreamChildren.length).toBeGreaterThanOrEqual(1);
    expect(latestAgentGenerateChild?.output).toBeDefined();
    expect(latestAgentStreamChild?.output).toBeDefined();
  } else {
    expect(agentGenerateOperation).toBeUndefined();
    expect(agentStreamOperation).toBeUndefined();
  }

  return {
    spanSummary: normalizeForSnapshot(
      normalizeAISDKSnapshotValue(
        [
          root,
          generateOperation,
          generateParent,
          generateChild,
          streamOperation,
          streamParent,
          streamChild,
          toolOperation,
          toolParent,
          ...toolSpans,
          generateObjectOperation,
          generateObjectParent,
          generateObjectChild,
          streamObjectOperation,
          streamObjectParent,
          streamObjectChild,
          agentGenerateOperation,
          agentGenerateParent,
          latestAgentGenerateChild,
          agentStreamOperation,
          agentStreamParent,
          latestAgentStreamChild,
        ]
          .filter((value) => value !== undefined)
          .map((event) =>
            summarizeWrapperContract(event!, [
              "aiSdkVersion",
              "provider",
              "model",
              "operation",
              "braintrust",
              "scenario",
            ]),
          ),
      ) as Json,
    ),
    payloadSummary: normalizeForSnapshot(
      normalizeAISDKPayloads(
        payloadRowsForRootSpan(payloads, root?.span.id),
      ) as Json | unknown[],
    ),
  };
}
