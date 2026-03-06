import { expect, test } from "vitest";
import {
  createTestRunId,
  getEvents,
  getPayloads,
  getTestServerEnv,
  isTestRunEvent,
} from "./helpers/ingestion";
import { normalizeForSnapshot, type Json } from "./helpers/normalize";
import type { CapturedLogEvent } from "./helpers/mock-braintrust-server";
import { runScenarioOrThrow } from "./helpers/run-scenario";

function summarizeEvent(event: CapturedLogEvent): Json {
  const row = event.row as Record<string, unknown>;
  const error =
    typeof row.error === "string"
      ? row.error.split("\n\n")[0]
      : row.error == null
        ? null
        : String(row.error);
  return {
    error,
    metadata: (row.metadata ?? null) as Json,
    name: event.span.name ?? null,
    output: (row.output ?? null) as Json,
    span_attributes: (row.span_attributes ?? null) as Json,
    span_id: (row.span_id ?? null) as Json,
    span_parents: (row.span_parents ?? null) as Json,
    root_span_id: (row.root_span_id ?? null) as Json,
  };
}

test("span-hierarchy covers context propagation, parent reattachment, span mutation, and automatic error logging", async () => {
  const testRunId = createTestRunId();

  await runScenarioOrThrow(
    "scenarios/span-hierarchy.ts",
    getTestServerEnv(testRunId),
  );

  const finalEventsByName = new Map<string, CapturedLogEvent>();
  for (const event of await getEvents((candidate) =>
    isTestRunEvent(candidate, testRunId),
  )) {
    if (event.span.name) {
      finalEventsByName.set(event.span.name, event);
    }
  }

  const orderedNames = [
    "top-level-start-span",
    "logger-root",
    "current-child",
    "fan-in",
    "reattached",
    "updatable",
    "traced-error",
    "wrapped-error",
    "traceable-error",
    "manual-error",
    "experiment-root",
    "experiment-child",
    "explicit-parent-child",
  ];

  const summarizedEvents = orderedNames.map((name) => {
    const event = finalEventsByName.get(name);
    if (!event) {
      throw new Error(`Missing span event: ${name}`);
    }
    return summarizeEvent(event);
  });

  expect(normalizeForSnapshot(summarizedEvents as Json)).toMatchSnapshot(
    "span-events",
  );

  const mutationRowIds = [
    finalEventsByName.get("fan-in")?.row.id,
    finalEventsByName.get("updatable")?.row.id,
  ].filter((value): value is string => typeof value === "string");
  const mutationRows = (await getPayloads())
    .flatMap((payload) => payload.rows)
    .filter((row) => mutationRowIds.includes(String(row.id ?? "")));

  expect(normalizeForSnapshot(mutationRows as Json)).toMatchSnapshot(
    "mutation-payload-rows",
  );
});
