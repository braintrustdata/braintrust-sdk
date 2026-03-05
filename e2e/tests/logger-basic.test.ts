import { expect, test } from "vitest";
import {
  createTestRunId,
  getPayloadsForRun,
  getTestServerEnv,
  waitForRunEvent,
} from "./helpers/ingestion";
import { normalizeForSnapshot, type Json } from "./helpers/normalize";
import { runScenarioOrThrow } from "./helpers/run-scenario";

test("logger-basic registers a project and sends normalized project logs", async () => {
  const testRunId = createTestRunId();
  const rootSpanPromise = waitForRunEvent(
    testRunId,
    (event) => event.span.name === "root-span" && event.span.ended,
  );
  const childSpanPromise = waitForRunEvent(
    testRunId,
    (event) => event.span.name === "child-span" && event.span.ended,
  );

  await runScenarioOrThrow(
    "scenarios/logger-basic.ts",
    getTestServerEnv(testRunId),
  );

  const [rootSpanEvent, childSpanEvent] = await Promise.all([
    rootSpanPromise,
    childSpanPromise,
  ]);

  expect(normalizeForSnapshot(rootSpanEvent.row as Json)).toMatchSnapshot(
    "root-span",
  );
  expect(normalizeForSnapshot(childSpanEvent.row as Json)).toMatchSnapshot(
    "child-span",
  );

  const logs3Payloads = await getPayloadsForRun(testRunId);
  expect(normalizeForSnapshot(logs3Payloads as Json)).toMatchSnapshot(
    "logs3-payloads",
  );
});
