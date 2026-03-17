import { expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  getWrapOpenAIScenarios,
  OPENAI_SCENARIO_TIMEOUT_MS,
  summarizeOpenAIContract,
} from "../../helpers/openai";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { findChildSpans, findLatestSpan } from "../../helpers/trace-selectors";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const wrapOpenAIScenarios = await getWrapOpenAIScenarios(scenarioDir);

const OPERATIONS = [
  {
    childName: "Chat Completion",
    expectsOutput: true,
    name: "openai-chat-operation",
    operation: "chat",
  },
  {
    childName: "Chat Completion",
    expectsOutput: true,
    name: "openai-chat-with-response-operation",
    operation: "chat-with-response",
  },
  {
    childName: "Chat Completion",
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-stream-operation",
    operation: "stream",
  },
  {
    childName: "Chat Completion",
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-stream-with-response-operation",
    operation: "stream-with-response",
  },
  {
    childName: "Chat Completion",
    expectsOutput: true,
    name: "openai-parse-operation",
    operation: "parse",
  },
  {
    childName: "Chat Completion",
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-sync-stream-operation",
    operation: "sync-stream",
  },
  {
    childName: "Embedding",
    expectsOutput: true,
    name: "openai-embeddings-operation",
    operation: "embeddings",
  },
  {
    childName: "Moderation",
    expectsOutput: true,
    name: "openai-moderations-operation",
    operation: "moderations",
  },
  {
    childName: "openai.responses.create",
    expectsOutput: true,
    name: "openai-responses-operation",
    operation: "responses",
  },
  {
    childName: "openai.responses.create",
    expectsOutput: true,
    name: "openai-responses-with-response-operation",
    operation: "responses-with-response",
  },
  {
    childName: "openai.responses.create",
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-responses-create-stream-operation",
    operation: "responses-create-stream",
  },
  {
    childName: "openai.responses.create",
    expectsOutput: true,
    expectsTimeToFirstToken: true,
    name: "openai-responses-stream-operation",
    operation: "responses-stream",
  },
  {
    childName: "openai.responses.create",
    expectsTimeToFirstToken: true,
    name: "openai-responses-stream-partial-operation",
    operation: "responses-stream-partial",
  },
  {
    childName: "openai.responses.parse",
    expectsOutput: true,
    name: "openai-responses-parse-operation",
    operation: "responses-parse",
  },
] as const;

test.each(
  wrapOpenAIScenarios.map(({ entry, version }) => [version, entry] as const),
)(
  "wrap-openai-conversation-traces logs wrapped endpoint traces (openai %s)",
  async (version, entry) => {
    await withScenarioHarness(async ({ events, runScenarioDir }) => {
      await runScenarioDir({
        entry,
        scenarioDir,
        timeoutMs: OPENAI_SCENARIO_TIMEOUT_MS,
      });

      const capturedEvents = events();
      const root = findLatestSpan(capturedEvents, "openai-wrapper-root");

      expect(root).toBeDefined();
      expect(root?.row.metadata).toMatchObject({
        openaiSdkVersion: version,
        scenario: "wrap-openai-conversation-traces",
      });

      const snapshotRows = [root];

      for (const operationSpec of OPERATIONS) {
        const operation = findLatestSpan(capturedEvents, operationSpec.name);
        expect(operation).toBeDefined();
        expect(operation?.row.metadata).toMatchObject({
          operation: operationSpec.operation,
        });
        expect(operation?.span.parentIds).toEqual([root?.span.id ?? ""]);

        const children = findChildSpans(
          capturedEvents,
          operationSpec.childName,
          operation?.span.id,
        );

        expect(children).toHaveLength(1);
        const child = children[0];
        snapshotRows.push(operation, child);

        expect(child?.row.metadata).toMatchObject({
          provider: "openai",
        });
        expect(
          typeof (child?.row.metadata as { model?: unknown } | undefined)
            ?.model,
        ).toBe("string");

        if ("expectsOutput" in operationSpec && operationSpec.expectsOutput) {
          expect(child?.output).toBeDefined();
        }

        if (
          "expectsTimeToFirstToken" in operationSpec &&
          operationSpec.expectsTimeToFirstToken
        ) {
          expect(child?.metrics?.time_to_first_token).toEqual(
            expect.any(Number),
          );
        }
      }

      if (!isCanaryMode()) {
        expect(
          normalizeForSnapshot(
            snapshotRows.map((event) =>
              summarizeOpenAIContract(event!),
            ) as Json,
          ),
        ).toMatchSnapshot("span-events");
      }
    });
  },
);
