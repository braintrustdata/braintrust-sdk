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

test("wrap-anthropic-message-traces captures create, stream, beta, attachment, and tool spans", async () => {
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
    const withResponseOperation = findLatestSpan(
      capturedEvents,
      "anthropic-stream-with-response-operation",
    );
    const toolOperation = findLatestSpan(
      capturedEvents,
      "anthropic-tool-operation",
    );
    const attachmentOperation = findLatestSpan(
      capturedEvents,
      "anthropic-attachment-operation",
    );
    const betaCreateOperation = findLatestSpan(
      capturedEvents,
      "anthropic-beta-create-operation",
    );
    const betaStreamOperation = findLatestSpan(
      capturedEvents,
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
      scenario: "wrap-anthropic-message-traces",
    });
    expect(createOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(withResponseOperation?.span.parentIds).toEqual([
      root?.span.id ?? "",
    ]);
    expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(attachmentOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(betaCreateOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(betaStreamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

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
    const withResponseChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      withResponseOperation?.span.id,
    );
    const toolChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      toolOperation?.span.id,
    );
    const attachmentChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      attachmentOperation?.span.id,
    );
    const betaCreateChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      betaCreateOperation?.span.id,
    );
    const betaStreamChildren = findChildSpans(
      capturedEvents,
      "anthropic.messages.create",
      betaStreamOperation?.span.id,
    );

    expect(createChildren).toHaveLength(1);
    expect(streamChildren).toHaveLength(1);
    expect(withResponseChildren).toHaveLength(1);
    expect(toolChildren).toHaveLength(1);
    expect(attachmentChildren).toHaveLength(1);
    expect(betaCreateChildren).toHaveLength(1);
    expect(betaStreamChildren).toHaveLength(1);

    const createSpan = createChildren[0];
    const streamSpan = streamChildren[0];
    const withResponseSpan = withResponseChildren[0];
    const toolSpan = toolChildren[0];
    const attachmentSpan = attachmentChildren[0];
    const betaCreateSpan = betaCreateChildren[0];
    const betaStreamSpan = betaStreamChildren[0];

    for (const wrapperSpan of [
      createSpan,
      streamSpan,
      withResponseSpan,
      toolSpan,
      attachmentSpan,
      betaCreateSpan,
      betaStreamSpan,
    ]) {
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

    const attachmentInput = JSON.stringify(attachmentSpan?.input);
    expect(attachmentInput).toContain("image.png");

    expect(
      normalizeForSnapshot(
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
    ).toMatchSnapshot("span-events");

    expect(
      normalizeForSnapshot(
        payloadRowsForRootSpan(payloads(), root?.span.id) as Json,
      ),
    ).toMatchSnapshot("log-payloads");
  });
});
