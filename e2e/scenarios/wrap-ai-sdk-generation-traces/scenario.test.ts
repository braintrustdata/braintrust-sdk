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
  findLatestChildSpan,
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

test.each(WRAP_AI_SDK_SCENARIOS)(
  "wrap-ai-sdk-generation-traces captures wrapper and child model spans (ai $version)",
  async ({ entry, supportsGenerateObject, supportsToolExecution, version }) => {
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

      expect(root).toBeDefined();
      expect(root?.row.metadata).toMatchObject({
        aiSdkVersion: version,
      });
      expect(generateOperation).toBeDefined();
      expect(streamOperation).toBeDefined();
      expect(toolOperation).toBeDefined();
      if (supportsGenerateObject) {
        expect(generateObjectOperation).toBeDefined();
      } else {
        expect(generateObjectOperation).toBeUndefined();
      }

      for (const operation of [
        generateOperation,
        streamOperation,
        toolOperation,
        generateObjectOperation,
      ].filter((value) => value !== undefined)) {
        expect(operation?.span.parentIds).toEqual([root?.span.id ?? ""]);
      }

      const generateParents = findChildSpans(
        capturedEvents,
        "generateText",
        generateOperation?.span.id,
      );
      const streamParents = findChildSpans(
        capturedEvents,
        "streamText",
        streamOperation?.span.id,
      );
      const toolParents = findChildSpans(
        capturedEvents,
        "generateText",
        toolOperation?.span.id,
      );
      const generateObjectParents =
        supportsGenerateObject && generateObjectOperation
          ? findChildSpans(
              capturedEvents,
              "generateObject",
              generateObjectOperation.span.id,
            )
          : [];

      expect(generateParents).toHaveLength(1);
      expect(streamParents).toHaveLength(1);
      expect(toolParents).toHaveLength(1);
      if (supportsGenerateObject) {
        expect(generateObjectParents).toHaveLength(1);
      } else {
        expect(generateObjectParents).toHaveLength(0);
      }

      const generateParent = generateParents[0];
      const streamParent = streamParents[0];
      const toolParent = toolParents[0];
      const generateObjectParent = generateObjectParents[0];

      const generateChildren = findChildSpans(
        capturedEvents,
        "doGenerate",
        generateParent?.span.id,
      );
      const streamChildren = findChildSpans(
        capturedEvents,
        "doStream",
        streamParent?.span.id,
      );
      const toolDoGenerateSpans = findAllSpans(capturedEvents, "doGenerate")
        .filter((event) => event.span.rootId === toolOperation?.span.rootId)
        .filter((event) => event.span.parentIds[0] !== generateParent?.span.id);
      const toolSpans = findAllSpans(capturedEvents, "get_weather").filter(
        (event) => event.span.rootId === toolOperation?.span.rootId,
      );
      const generateObjectChildren =
        supportsGenerateObject && generateObjectParent
          ? findChildSpans(
              capturedEvents,
              "doGenerate",
              generateObjectParent.span.id,
            )
          : [];
      const generateChild = findLatestChildSpan(
        capturedEvents,
        "doGenerate",
        generateParent?.span.id,
      );
      const streamChild = findLatestChildSpan(
        capturedEvents,
        "doStream",
        streamParent?.span.id,
      );

      expect(generateChildren).toHaveLength(1);
      expect(streamChildren).toHaveLength(1);
      if (supportsToolExecution) {
        expect(toolDoGenerateSpans.length).toBeGreaterThanOrEqual(2);
        expect(toolSpans.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(toolDoGenerateSpans.length).toBeGreaterThanOrEqual(1);
      }
      if (supportsGenerateObject) {
        expect(generateObjectChildren).toHaveLength(1);
      } else {
        expect(generateObjectChildren).toHaveLength(0);
      }

      expect(generateParent?.row.metadata).toMatchObject({
        braintrust: {
          integration_name: "ai-sdk",
          sdk_language: "typescript",
        },
      });
      expect(
        typeof (
          generateParent?.row.metadata as { provider?: unknown } | undefined
        )?.provider,
      ).toBe("string");
      expect(
        (generateParent?.row.metadata as { provider?: string } | undefined)
          ?.provider,
      ).toContain("openai");
      expect(
        typeof (generateParent?.row.metadata as { model?: unknown } | undefined)
          ?.model,
      ).toBe("string");
      expect(generateParent?.output).toBeDefined();
      expect(generateParent?.metrics?.tokens).toBeUndefined();
      expect(generateParent?.metrics?.prompt_tokens).toBeUndefined();
      expect(generateParent?.metrics?.completion_tokens).toBeUndefined();

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
      const toolCallNames = collectToolCallNames(toolParent?.output);
      if (supportsToolExecution) {
        const toolRootIds = new Set(
          [toolOperation, toolParent, ...toolDoGenerateSpans, ...toolSpans]
            .map((event) => event?.span.rootId)
            .filter((value): value is string => typeof value === "string"),
        );
        expect(toolRootIds.size).toBe(1);
        expect(toolSpans[0]?.input).toBeDefined();
        expect(toolSpans[0]?.output).toBeDefined();
      } else {
        expect(toolCallNames).toContain("get_weather");
      }

      if (supportsGenerateObject) {
        const generateObjectOutput = generateObjectParent?.output as
          | {
              object?: { city?: string };
            }
          | undefined;
        expect(generateObjectOutput?.object?.city).toBe("Paris");
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
            ...toolDoGenerateSpans,
            ...toolSpans,
            generateObjectOperation,
            generateObjectParent,
            ...generateObjectChildren,
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
