import { beforeAll, expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  installScenarioDependencies,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { findChildSpans, findLatestSpan } from "../../helpers/trace-selectors";
import {
  payloadRowsForRootSpan,
  summarizeWrapperContract,
} from "../../helpers/wrapper-contract";

const scenarioDir = resolveScenarioDir(import.meta.url);
const TIMEOUT_MS = 90_000;

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

test("wrap-anthropic-message-traces captures create, stream, and tool spans", async () => {
  await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

    const capturedEvents = events();
    const root = findLatestSpan(capturedEvents, "anthropic-wrapper-root");
    const createOperation = findLatestSpan(
      capturedEvents,
      "anthropic-create-operation",
    );
    const streamOperation = findLatestSpan(
      capturedEvents,
      "anthropic-stream-operation",
    );
    const toolOperation = findLatestSpan(
      capturedEvents,
      "anthropic-tool-operation",
    );

    expect(root).toBeDefined();
    expect(createOperation).toBeDefined();
    expect(streamOperation).toBeDefined();
    expect(toolOperation).toBeDefined();

    expect(root?.row.metadata).toMatchObject({
      scenario: "wrap-anthropic-message-traces",
    });
    expect(createOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

    const createChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      createOperation?.span.id,
    );
    const streamChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      streamOperation?.span.id,
    );
    const toolChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      toolOperation?.span.id,
    );

    expect(createChildren).toHaveLength(1);
    expect(streamChildren).toHaveLength(1);
    expect(toolChildren).toHaveLength(1);

    const createSpan = createChildren[0];
    const streamSpan = streamChildren[0];
    const toolSpan = toolChildren[0];

    for (const wrapperSpan of [createSpan, streamSpan, toolSpan]) {
      expect(wrapperSpan?.row.metadata).toMatchObject({
        provider: "anthropic",
      });
      expect(
        typeof (wrapperSpan?.row.metadata as { model?: unknown } | undefined)
          ?.model,
      ).toBe("string");
    }

    expect(streamSpan?.metrics).toMatchObject({
      time_to_first_token: expect.any(Number),
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
    });

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

    expect(
      normalizeForSnapshot(
        [
          root,
          createOperation,
          createSpan,
          streamOperation,
          streamSpan,
          toolOperation,
          toolSpan,
        ].map((event) =>
          summarizeWrapperContract(event!, [
            "provider",
            "model",
            "operation",
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
