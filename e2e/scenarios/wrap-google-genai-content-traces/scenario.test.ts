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

test("wrap-google-genai-content-traces captures generate, stream, and tool spans", async () => {
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
    const toolOperation = findLatestSpan(
      capturedEvents,
      "google-tool-operation",
    );

    expect(root).toBeDefined();
    expect(generateOperation).toBeDefined();
    expect(streamOperation).toBeDefined();
    expect(toolOperation).toBeDefined();

    expect(root?.row.metadata).toMatchObject({
      scenario: "wrap-google-genai-content-traces",
    });
    expect(generateOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(streamOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);
    expect(toolOperation?.span.parentIds).toEqual([root?.span.id ?? ""]);

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
    const toolChildren = findChildSpans(
      capturedEvents,
      "generate_content",
      toolOperation?.span.id,
    );

    expect(generateChildren).toHaveLength(1);
    expect(streamChildren).toHaveLength(1);
    expect(toolChildren).toHaveLength(1);

    const generateSpan = generateChildren[0];
    const streamSpan = streamChildren[0];
    const toolSpan = toolChildren[0];

    for (const wrapperSpan of [generateSpan, streamSpan, toolSpan]) {
      expect(wrapperSpan?.row.metadata).toMatchObject({
        model: "gemini-2.0-flash-001",
      });
    }

    expect(streamSpan?.metrics).toMatchObject({
      time_to_first_token: expect.any(Number),
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
    });

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

    expect(
      normalizeForSnapshot(
        [
          root,
          generateOperation,
          generateSpan,
          streamOperation,
          streamSpan,
          toolOperation,
          toolSpan,
        ].map((event) =>
          summarizeWrapperContract(event!, ["model", "operation", "scenario"]),
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
