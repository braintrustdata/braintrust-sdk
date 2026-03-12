import { beforeAll, expect, test } from "vitest";
import {
  AI_SDK_SCENARIO_TIMEOUT_MS,
  WRAP_AI_SDK_SCENARIOS,
} from "../../helpers/ai-sdk";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  installScenarioDependencies,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import {
  findAllSpans,
  findChildSpans,
  findLatestSpan,
} from "../../helpers/trace-selectors";
import {
  payloadRowsForRootSpan,
  summarizeWrapperContract,
} from "../../helpers/wrapper-contract";

const scenarioDir = resolveScenarioDir(import.meta.url);

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

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
  capturedEvents: ReturnType<typeof findAllSpans>,
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

test.each(WRAP_AI_SDK_SCENARIOS)(
  "wrap-ai-sdk-generation-traces captures wrapper and child model spans (ai $version)",
  async ({
    agentSpanName,
    entry,
    supportsGenerateObject,
    supportsStreamObject,
    supportsToolExecution,
    version,
  }) => {
    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({
        entry,
        scenarioDir,
        timeoutMs: AI_SDK_SCENARIO_TIMEOUT_MS,
      });

      const capturedEvents = events();
      const root = findLatestSpan(capturedEvents, "ai-sdk-wrapper-root");
      const generateOperation = findLatestSpan(
        capturedEvents,
        "ai-sdk-generate-operation",
      );
      const streamOperation = findLatestSpan(
        capturedEvents,
        "ai-sdk-stream-operation",
      );
      const toolOperation = findLatestSpan(
        capturedEvents,
        "ai-sdk-tool-operation",
      );
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
        scenario: "wrap-ai-sdk-generation-traces",
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
          typeof (parent?.row.metadata as { provider?: unknown } | undefined)
            ?.provider,
        ).toBe("string");
        expect(
          (parent?.row.metadata as { provider?: string } | undefined)?.provider,
        ).toContain("openai");
        expect(
          typeof (parent?.row.metadata as { model?: unknown } | undefined)
            ?.model,
        ).toBe("string");
      }

      const generateChild = findChildSpans(
        capturedEvents,
        "doGenerate",
        generateParent?.span.id,
      )[0];
      const streamChild = findChildSpans(
        capturedEvents,
        "doStream",
        streamParent?.span.id,
      )[0];
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
        findChildSpans(
          capturedEvents,
          "doGenerate",
          generateObjectParent.span.id,
        ).at(0);
      const streamObjectChild =
        streamObjectParent &&
        findChildSpans(
          capturedEvents,
          "doStream",
          streamObjectParent.span.id,
        ).at(0);
      const agentGenerateChildren = agentGenerateParent
        ? findModelChildren(capturedEvents, agentGenerateParent.span.id)
        : [];
      const agentStreamChildren = agentStreamParent
        ? findModelChildren(capturedEvents, agentStreamParent.span.id)
        : [];

      expect(generateChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
      expect(generateChild?.metrics?.completion_tokens).toEqual(
        expect.any(Number),
      );
      if (generateChild?.metrics?.tokens !== undefined) {
        expect(generateChild.metrics.tokens).toEqual(expect.any(Number));
      }

      expect(streamParent?.metrics?.time_to_first_token).toEqual(
        expect.any(Number),
      );
      expect(streamChild?.output).toBeDefined();
      expect(streamChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
      expect(streamChild?.metrics?.completion_tokens).toEqual(
        expect.any(Number),
      );
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
        expect(collectToolCallNames(toolParent?.output)).toContain(
          "get_weather",
        );
      }

      if (supportsGenerateObject) {
        expect(generateObjectOperation).toBeDefined();
        expect(generateObjectParent?.output).toMatchObject({
          object: { city: "Paris" },
        });
        expect(generateObjectChild?.output).toBeDefined();
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
        expect(streamObjectParent?.output).toMatchObject({
          object: { city: "Paris" },
        });
        expect(streamObjectChild?.output).toBeDefined();
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
      } else {
        expect(agentGenerateOperation).toBeUndefined();
        expect(agentStreamOperation).toBeUndefined();
      }

      expect(
        normalizeForSnapshot(
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
            ...toolModelSpans,
            ...toolSpans,
            generateObjectOperation,
            generateObjectParent,
            generateObjectChild,
            streamObjectOperation,
            streamObjectParent,
            streamObjectChild,
            agentGenerateOperation,
            agentGenerateParent,
            ...agentGenerateChildren,
            agentStreamOperation,
            agentStreamParent,
            ...agentStreamChildren,
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
            ) as Json,
        ),
      ).toMatchSnapshot("span-events");

      expect(
        normalizeForSnapshot(
          payloadRowsForRootSpan(payloads(), root?.span.id) as Json,
        ),
      ).toMatchSnapshot("log-payloads");
    });
  },
);
