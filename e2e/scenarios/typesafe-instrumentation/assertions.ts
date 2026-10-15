import { beforeAll, describe, expect, test } from "vitest";
import type { CapturedLogEvent } from "../../helpers/mock-braintrust-server";
import { resolveFileSnapshotPath } from "../../helpers/file-snapshot";
import {
  withScenarioHarness,
  type ScenarioRunContext,
} from "../../helpers/scenario-harness";
import { matchSpanTreeSnapshot } from "../../helpers/span-tree";
import {
  findLatestChildSpan,
  findLatestSpan,
} from "../../helpers/trace-selectors";
import { ROOT_NAME, SCENARIO_NAME } from "./scenario.impl.mjs";

type RunTypeSafeScenario = (harness: {
  runNodeScenarioDir: (options: {
    entry: string;
    env: Record<string, string>;
    nodeArgs: string[];
    runContext?: ScenarioRunContext;
    scenarioDir: string;
  }) => Promise<unknown>;
  runScenarioDir: (options: {
    entry: string;
    env: Record<string, string>;
    runContext?: ScenarioRunContext;
    scenarioDir: string;
  }) => Promise<unknown>;
}) => Promise<void>;

function spanTreeEvents(
  events: CapturedLogEvent[],
  supportsImages: boolean,
): CapturedLogEvent[] {
  const operations = [
    "typesafe-mixed-operation",
    "typesafe-raw-operation",
    ...(supportsImages
      ? [
          "typesafe-image-operation",
          "typesafe-template-operation",
          "typesafe-box-operation",
        ]
      : []),
  ];
  return [
    findLatestSpan(events, ROOT_NAME),
    ...operations.flatMap((operationName) => {
      const operation = findLatestSpan(events, operationName);
      return [
        operation,
        findLatestChildSpan(events, "typesafe.systemOne", operation?.span.id),
      ];
    }),
  ].map((event) => event!);
}

export function defineTypeSafeInstrumentationAssertions(options: {
  name: string;
  runScenario: RunTypeSafeScenario;
  snapshotName: string;
  supportsImages: boolean;
  testFileUrl: string;
}): void {
  const spanSnapshotPath = resolveFileSnapshotPath(
    options.testFileUrl,
    `${options.snapshotName}.span-tree.json`,
  );

  describe(options.name, () => {
    let events: CapturedLogEvent[] = [];

    beforeAll(async () => {
      await withScenarioHarness(async (harness) => {
        await options.runScenario(harness);
        events = harness.events();
      });
    });

    test("captures native questions and every structured answer", () => {
      const root = findLatestSpan(events, ROOT_NAME);
      const operation = findLatestSpan(events, "typesafe-mixed-operation");
      const span = findLatestChildSpan(
        events,
        "typesafe.systemOne",
        operation?.span.id,
      );

      expect(root?.row.metadata).toMatchObject({ scenario: SCENARIO_NAME });
      expect(span?.span.type).toBe("question");
      expect(span?.input).toMatchObject({
        state: { message: expect.any(String) },
        questions: expect.arrayContaining([
          expect.objectContaining({ id: "category", type: "choice" }),
          expect.objectContaining({ id: "urgency", type: "score" }),
          expect.objectContaining({ id: "duplicate_charge", type: "noul" }),
        ]),
      });
      expect(span?.output).toMatchObject({
        answers: expect.arrayContaining([
          expect.objectContaining({
            id: "category",
            type: "choice",
            choice: expect.any(String),
            confidence: expect.any(Number),
            probabilities: expect.any(Object),
          }),
          expect.objectContaining({
            id: "urgency",
            type: "score",
            score: expect.any(Number),
            confidence: expect.any(Number),
            legend: expect.any(Object),
            probabilities: expect.any(Object),
          }),
          expect.objectContaining({
            id: "duplicate_charge",
            type: "noul",
            noul: expect.any(Number),
          }),
        ]),
      });
      expect(span?.row.metadata).toMatchObject({
        model: expect.stringMatching(/^jev-/),
        provider: "typesafe",
      });
      expect(span?.metrics).toMatchObject({
        completion_tokens: expect.any(Number),
        prompt_tokens: expect.any(Number),
        tokens: expect.any(Number),
      });
    });

    test("captures output while preserving raw response access", () => {
      const operation = findLatestSpan(events, "typesafe-raw-operation");
      const span = findLatestChildSpan(
        events,
        "typesafe.systemOne",
        operation?.span.id,
      );

      expect(span?.input).toMatchObject({
        state: "The package arrived intact and on time.",
        questions: [{ id: "positive", type: "noul" }],
      });
      expect(span?.output).toMatchObject({
        answers: [{ id: "positive", type: "noul", noul: expect.any(Number) }],
      });
      expect(span?.row.metadata).toMatchObject({
        model: "jev-1.13.0",
        provider: "typesafe",
      });
    });

    if (options.supportsImages) {
      test("preserves image references without capturing bytes by default", () => {
        const operation = findLatestSpan(events, "typesafe-image-operation");
        const span = findLatestChildSpan(
          events,
          "typesafe.systemOne",
          operation?.span.id,
        );
        const input = span?.input as {
          state: string;
          assets: Record<string, unknown>;
        };
        expect(input.state).toMatch(/^<image:[a-f0-9]{32}>$/);
        expect(input.assets).toEqual({ [input.state]: { type: "image" } });
        expect(span?.output).toMatchObject({
          answers: [{ id: "ship", type: "noul", noul: expect.any(Number) }],
        });
      });

      test("captures template assets in state, instructions and criteria only once", () => {
        const operation = findLatestSpan(events, "typesafe-template-operation");
        const span = findLatestChildSpan(
          events,
          "typesafe.systemOne",
          operation?.span.id,
        );
        const input = span?.input as { assets: Record<string, unknown> };
        const references = Object.keys(input.assets);
        expect(references).toHaveLength(1);
        const reference = references[0];
        expect(input).toMatchObject({
          state: { scene: `Look at ${reference}.` },
          questions: [
            {
              id: "weather",
              instructions: `What weather is shown in ${reference}?`,
              criteria: { stormy: `Stormy weather in ${reference}` },
            },
          ],
          assets: {
            [reference]: {
              type: "braintrust_attachment",
              content_type: "image/png",
            },
          },
        });
        expect(span?.output).toMatchObject({
          answers: [
            { id: "weather", type: "choice", choice: expect.any(String) },
          ],
        });
      });

      test("captures named image assets and bounding box answers", () => {
        const operation = findLatestSpan(events, "typesafe-box-operation");
        const span = findLatestChildSpan(
          events,
          "typesafe.systemOne",
          operation?.span.id,
        );
        expect(span?.input).toMatchObject({
          state: "Locate the ship in <photo>.",
          questions: [
            { id: "ship", type: "box", instructions: "The sailing ship" },
          ],
          assets: {
            "<photo>": {
              type: "braintrust_attachment",
              content_type: "image/png",
            },
          },
        });
        expect(span?.output).toMatchObject({
          answers: [
            {
              id: "ship",
              type: "box",
              box: {
                top: expect.any(Number),
                bottom: expect.any(Number),
                left: expect.any(Number),
                right: expect.any(Number),
              },
              confidence: expect.toSatisfy(
                (value: unknown) => value === null || typeof value === "number",
              ),
            },
          ],
        });
        expect(span?.row.metadata).toMatchObject({
          model: expect.stringMatching(/^jev-/),
          provider: "typesafe",
        });
        expect(span?.metrics).toMatchObject({
          prompt_tokens: expect.any(Number),
        });
      });
    }

    test("matches the span tree snapshot", async () => {
      // Image references are random per SDK object; preserve their relationships.
      const normalized = JSON.parse(
        JSON.stringify(spanTreeEvents(events, options.supportsImages)).replace(
          /<image:[a-f0-9]{32}>/g,
          "<image:reference>",
        ),
      );
      await matchSpanTreeSnapshot(normalized, spanSnapshotPath);
    });
  });
}
