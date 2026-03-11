import { beforeAll, expect, test } from "vitest";
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
const TIMEOUT_MS = 90_000;

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

test("wrap-ai-sdk-generation-traces captures wrapper and child model spans", async () => {
  await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

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
    expect(generateOperation).toBeDefined();
    expect(streamOperation).toBeDefined();
    expect(toolOperation).toBeDefined();
    expect(generateObjectOperation).toBeDefined();

    for (const operation of [
      generateOperation,
      streamOperation,
      toolOperation,
      generateObjectOperation,
    ]) {
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
    const generateObjectParents = findChildSpans(
      capturedEvents,
      "generateObject",
      generateObjectOperation?.span.id,
    );

    expect(generateParents).toHaveLength(1);
    expect(streamParents).toHaveLength(1);
    expect(toolParents).toHaveLength(1);
    expect(generateObjectParents).toHaveLength(1);

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
    const toolDoGenerateSpans = findAllSpans(
      capturedEvents,
      "doGenerate",
    ).filter((event) => event.span.rootId === toolOperation?.span.rootId);
    const toolSpans = findAllSpans(capturedEvents, "get_weather").filter(
      (event) => event.span.rootId === toolOperation?.span.rootId,
    );
    const generateObjectChildren = findChildSpans(
      capturedEvents,
      "doGenerate",
      generateObjectParent?.span.id,
    );

    expect(generateChildren).toHaveLength(1);
    expect(streamChildren).toHaveLength(1);
    expect(toolDoGenerateSpans.length).toBeGreaterThanOrEqual(2);
    expect(toolSpans.length).toBeGreaterThanOrEqual(1);
    expect(generateObjectChildren).toHaveLength(1);

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

    const generateChild = generateChildren[0];
    expect(generateChild?.metrics?.tokens).toEqual(expect.any(Number));
    expect(generateChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
    expect(generateChild?.metrics?.completion_tokens).toEqual(
      expect.any(Number),
    );

    expect(streamParent?.metrics?.time_to_first_token).toEqual(
      expect.any(Number),
    );
    const streamChild = streamChildren[0];
    expect(streamChild?.output).toBeDefined();
    expect(streamChild?.metrics?.tokens).toEqual(expect.any(Number));
    expect(streamChild?.metrics?.prompt_tokens).toEqual(expect.any(Number));
    expect(streamChild?.metrics?.completion_tokens).toEqual(expect.any(Number));

    const toolRootIds = new Set(
      [toolOperation, toolParent, ...toolDoGenerateSpans, ...toolSpans]
        .map((event) => event?.span.rootId)
        .filter((value): value is string => typeof value === "string"),
    );
    expect(toolRootIds.size).toBe(1);
    expect(toolSpans[0]?.input).toBeDefined();
    expect(toolSpans[0]?.output).toBeDefined();

    const generateObjectOutput = generateObjectParent?.output as
      | {
          object?: { city?: string };
        }
      | undefined;
    expect(generateObjectOutput?.object?.city).toBe("Paris");

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
          generateObjectChildren[0],
        ].map((event) =>
          summarizeWrapperContract(event!, [
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
});
