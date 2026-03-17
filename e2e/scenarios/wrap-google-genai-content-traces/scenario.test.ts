import { expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { findChildSpans, findLatestSpan } from "../../helpers/trace-selectors";
import {
  payloadRowsForRootSpan,
  summarizeWrapperContract,
} from "../../helpers/wrapper-contract";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;

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

test("wrap-google-genai-content-traces captures generate, attachment, stream, early-return, and tool spans", async () => {
  await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

    const capturedEvents = events();
    const root = findLatestSpan(capturedEvents, "google-genai-wrapper-root");
    const generateOperation = findLatestSpan(
      capturedEvents,
      "google-generate-operation",
    );
    const streamOperation = findLatestSpan(
      capturedEvents,
      "google-stream-operation",
    );
    const streamReturnOperation = findLatestSpan(
      capturedEvents,
      "google-stream-return-operation",
    );
    const toolOperation = findLatestSpan(
      capturedEvents,
      "google-tool-operation",
    );
    const attachmentOperation = findLatestSpan(
      capturedEvents,
      "google-attachment-operation",
    );

    expect(root).toBeDefined();
    expect(generateOperation).toBeDefined();
    expect(streamOperation).toBeDefined();
    expect(streamReturnOperation).toBeDefined();
    expect(toolOperation).toBeDefined();
    expect(attachmentOperation).toBeDefined();

    expect(root?.row.metadata).toMatchObject({
      scenario: "wrap-google-genai-content-traces",
    });
    expect(generateOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(streamReturnOperation?.span.parentIds).toEqual([
      root?.span.id ?? "",
    ]);
    expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(attachmentOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

    const generateChildren = findChildSpans(
      capturedEvents,
      "generate_content",
      generateOperation?.span.id,
    );
    const streamChildren = findChildSpans(
      capturedEvents,
      "generate_content_stream",
      streamOperation?.span.id,
    );
    const streamReturnChildren = findChildSpans(
      capturedEvents,
      "generate_content_stream",
      streamReturnOperation?.span.id,
    );
    const toolChildren = findChildSpans(
      capturedEvents,
      "generate_content",
      toolOperation?.span.id,
    );
    const attachmentChildren = findChildSpans(
      capturedEvents,
      "generate_content",
      attachmentOperation?.span.id,
    );

    expect(generateChildren).toHaveLength(1);
    expect(streamChildren).toHaveLength(1);
    expect(streamReturnChildren).toHaveLength(1);
    expect(toolChildren).toHaveLength(1);
    expect(attachmentChildren).toHaveLength(1);

    const generateSpan = generateChildren[0];
    const streamSpan = streamChildren[0];
    const streamReturnSpan = streamReturnChildren[0];
    const toolSpan = toolChildren[0];
    const attachmentSpan = attachmentChildren[0];

    for (const wrapperSpan of [
      generateSpan,
      streamSpan,
      streamReturnSpan,
      toolSpan,
      attachmentSpan,
    ]) {
      expect(wrapperSpan?.row.metadata).toMatchObject({
        model: "gemini-2.0-flash-001",
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

    const toolInput = toolSpan?.input as
      | {
          config?: {
            tools?: Array<{
              functionDeclarations?: Array<{ name?: string }>;
            }>;
          };
        }
      | undefined;
    expect(
      toolInput?.config?.tools?.some((tool) =>
        tool.functionDeclarations?.some(
          (declaration) => declaration.name === "get_weather",
        ),
      ),
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

    if (!isCanaryMode()) {
      expect(
        normalizeForSnapshot(
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
            summarizeWrapperContract(event!, [
              "model",
              "operation",
              "scenario",
            ]),
          ) as Json,
        ),
      ).toMatchSnapshot("span-events");

      expect(
        normalizeForSnapshot(
          normalizeGooglePayloads(
            payloadRowsForRootSpan(payloads(), root?.span.id),
          ) as Json,
        ),
      ).toMatchSnapshot("log-payloads");
    }
  });
});
