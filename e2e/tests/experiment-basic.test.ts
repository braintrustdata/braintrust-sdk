import { expect, test } from "vitest";
import {
  createTestRunId,
  getPayloadsForRun,
  getTestServerEnv,
  waitForRunEvent,
} from "./helpers/ingestion";
import { normalizeForSnapshot, type Json } from "./helpers/normalize";
import { runScenarioOrThrow } from "./helpers/run-scenario";

test("experiment-basic registers an experiment and sends normalized experiment logs", async () => {
  const testRunId = createTestRunId();
  const rootSpanPromise = waitForRunEvent(
    testRunId,
    (event) => event.span.name === "experiment-root" && event.span.ended,
  );
  const toolSpanPromise = waitForRunEvent(
    testRunId,
    (event) => event.span.name === "tool-span" && event.span.ended,
  );

  await runScenarioOrThrow(
    "scenarios/experiment-basic.ts",
    getTestServerEnv(testRunId),
  );

  const [rootSpanEvent, toolSpanEvent] = await Promise.all([
    rootSpanPromise,
    toolSpanPromise,
  ]);

  expect(normalizeForSnapshot(rootSpanEvent.row as Json)).toMatchSnapshot(
    "root-span",
  );
  expect(normalizeForSnapshot(toolSpanEvent.row as Json)).toMatchSnapshot(
    "tool-span",
  );

  const logs3Payloads = await getPayloadsForRun(testRunId);
  expect(normalizeForSnapshot(logs3Payloads as Json)).toMatchSnapshot(
    "logs3-payloads",
  );
});
