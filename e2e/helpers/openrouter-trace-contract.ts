import { expect } from "vitest";
import { normalizeForSnapshot, type Json } from "./normalize";
import type { CapturedLogEvent } from "./mock-braintrust-server";
import { findChildSpans, findLatestSpan } from "./trace-selectors";
import { summarizeWrapperContract } from "./wrapper-contract";

const CHAT_MODEL = "openai/gpt-4.1-mini";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

const OPERATIONS = [
  {
    childNames: ["openrouter.chat.send"],
    expectedModel: CHAT_MODEL,
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openrouter-chat-operation",
    operation: "chat",
    type: "llm",
  },
  {
    childNames: ["openrouter.chat.send"],
    expectedModel: CHAT_MODEL,
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openrouter-chat-stream-operation",
    operation: "chat-stream",
    type: "llm",
  },
  {
    childNames: ["openrouter.embeddings.generate"],
    expectedModelPrefix: "text-embedding-3-small",
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openrouter-embeddings-operation",
    operation: "embeddings",
    type: "llm",
  },
  {
    childNames: ["openrouter.beta.responses.send"],
    expectedModelPrefix: CHAT_MODEL,
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openrouter-responses-operation",
    operation: "responses",
    type: "llm",
  },
  {
    childNames: ["openrouter.beta.responses.send"],
    expectedModelPrefix: CHAT_MODEL,
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openrouter-responses-stream-operation",
    operation: "responses-stream",
    type: "llm",
  },
  {
    childNames: ["openrouter.callModel"],
    expectedModelPrefix: CHAT_MODEL,
    expectsOutput: true,
    expectsTimeToFirstToken: false,
    name: "openrouter-call-model-operation",
    nestedLLMChildMinCount: 2,
    nestedLLMChildNames: ["openrouter.beta.responses.send"],
    nestedChildNames: ["lookup_weather", "openrouter.tool"],
    operation: "call-model",
    type: "llm",
  },
] as const;

function findChildrenForOperation(
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

function assertNestedToolSpan(
  capturedEvents: CapturedLogEvent[],
  childNames: readonly string[],
  parentId: string | undefined,
) {
  const nestedChildren = findChildrenForOperation(
    capturedEvents,
    childNames,
    parentId,
  );
  expect(nestedChildren.length).toBeGreaterThanOrEqual(1);

  const nestedChild =
    nestedChildren.find((candidate) => candidate.output !== undefined) ??
    nestedChildren.at(-1);
  expect(nestedChild?.span.type).toBe("tool");
  expect(nestedChild?.input).toMatchObject({
    city: "Vienna",
  });
  expect(nestedChild?.row.metadata).toMatchObject({
    provider: "openrouter",
    tool_name: "lookup_weather",
  });
  expect(nestedChild?.output).toMatchObject({
    forecast: "Sunny in Vienna",
  });
}

function assertNestedLLMSpans(args: {
  capturedEvents: CapturedLogEvent[];
  childNames: readonly string[];
  expectedMinCount: number;
  expectedModelPrefix: string;
  parentId: string | undefined;
}) {
  const nestedChildren = findChildrenForOperation(
    args.capturedEvents,
    args.childNames,
    args.parentId,
  );
  expect(nestedChildren.length).toBeGreaterThanOrEqual(args.expectedMinCount);

  for (const [index, nestedChild] of nestedChildren.entries()) {
    expect(nestedChild?.span.type).toBe("llm");
    expect(nestedChild?.row.metadata).toMatchObject({
      provider: "openrouter",
      step: index + 1,
    });
    expect(String(nestedChild?.row.metadata?.model)).toContain(
      args.expectedModelPrefix,
    );
    expect(nestedChild?.output).toBeDefined();
  }
}

export function assertOpenRouterTraceContract(options: {
  capturedEvents: CapturedLogEvent[];
  rootName: string;
  scenarioName: string;
  snapshotRootName?: string;
  version: string;
}): { spanSummary: Json } {
  const root = findLatestSpan(options.capturedEvents, options.rootName);

  expect(root).toBeDefined();
  expect(root?.row.metadata).toMatchObject({
    openrouterSdkVersion: options.version,
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

    const children = findChildrenForOperation(
      options.capturedEvents,
      operationSpec.childNames,
      operation?.span.id,
    );
    expect(children.length).toBeGreaterThanOrEqual(1);

    const child =
      children.find((candidate) => candidate.output !== undefined) ??
      children.at(-1);
    snapshotRows.push(operation, child);

    expect(child?.span.type).toBe(operationSpec.type);

    if (operationSpec.type === "tool") {
      expect(child?.input).toMatchObject({
        city: "Vienna",
      });
      expect(child?.row.metadata).toMatchObject({
        provider: "openrouter",
        tool_name: "lookup_weather",
      });
      expect(child?.output).toMatchObject({
        forecast: "Sunny in Vienna",
      });
    } else {
      expect(child?.row.metadata).toMatchObject({
        provider: "openrouter",
      });

      const childMetadata = child?.row.metadata as
        | {
            model?: unknown;
          }
        | undefined;
      if ("expectedModel" in operationSpec) {
        expect(childMetadata?.model).toBe(operationSpec.expectedModel);
      }
      if ("expectedModelPrefix" in operationSpec) {
        expect(typeof childMetadata?.model).toBe("string");
        expect(String(childMetadata?.model)).toContain(
          operationSpec.expectedModelPrefix,
        );
      }

      if (operationSpec.name === "openrouter-embeddings-operation") {
        expect(child?.output).toMatchObject({
          embedding_length: expect.any(Number),
        });
        expect(
          (child?.output as { embedding_length?: number } | undefined)
            ?.embedding_length,
        ).toBeGreaterThan(0);
      }

      if (
        operationSpec.name === "openrouter-responses-operation" ||
        operationSpec.name === "openrouter-responses-stream-operation"
      ) {
        expect(child?.row.metadata).toMatchObject({
          id: expect.any(String),
          status: expect.any(String),
        });
      }
    }

    if (operationSpec.expectsOutput) {
      expect(child?.output).toBeDefined();
    }

    if (operationSpec.expectsTimeToFirstToken) {
      expect(child?.metrics?.time_to_first_token).toEqual(expect.any(Number));
    }

    if ("nestedChildNames" in operationSpec) {
      assertNestedToolSpan(
        options.capturedEvents,
        operationSpec.nestedChildNames,
        child?.span.id,
      );
    }

    if ("nestedLLMChildNames" in operationSpec) {
      assertNestedLLMSpans({
        capturedEvents: options.capturedEvents,
        childNames: operationSpec.nestedLLMChildNames,
        expectedMinCount: operationSpec.nestedLLMChildMinCount,
        expectedModelPrefix: operationSpec.expectedModelPrefix,
        parentId: child?.span.id,
      });
    }
  }

  return {
    spanSummary: normalizeForSnapshot(
      snapshotRows.map((event) => {
        const summary = summarizeWrapperContract(event!, [
          "model",
          "openrouterSdkVersion",
          "operation",
          "provider",
          "scenario",
          "tool_name",
        ]) as {
          name?: string | null;
        };

        if (options.snapshotRootName && summary.name === options.rootName) {
          summary.name = options.snapshotRootName;
        }

        return summary;
      }) as Json,
    ),
  };
}
