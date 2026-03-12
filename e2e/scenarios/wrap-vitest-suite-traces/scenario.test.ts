import { expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { findLatestSpan } from "../../helpers/trace-selectors";
import {
  payloadRowsForTestRunId,
  summarizeWrapperContract,
} from "../../helpers/wrapper-contract";

const scenarioDir = resolveScenarioDir(import.meta.url);
const TIMEOUT_MS = 90_000;

test("wrap-vitest-suite-traces captures wrapped Vitest task spans", async () => {
  await withScenarioHarness(
    async ({ payloads, runScenarioDir, testRunEvents, testRunId }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const capturedEvents = testRunEvents();
      const simplePass = findLatestSpan(capturedEvents, "vitest simple pass");
      const configured = findLatestSpan(
        capturedEvents,
        "vitest configured span",
      );
      const concurrentAlpha = findLatestSpan(
        capturedEvents,
        "vitest concurrent alpha",
      );
      const concurrentBeta = findLatestSpan(
        capturedEvents,
        "vitest concurrent beta",
      );
      const expectedFailure = findLatestSpan(
        capturedEvents,
        "vitest expected failure",
      );

      for (const span of [
        simplePass,
        configured,
        concurrentAlpha,
        concurrentBeta,
        expectedFailure,
      ]) {
        expect(span).toBeDefined();
        expect(span?.span.type).toBe("task");
      }

      expect(configured?.input).toEqual({ value: 5 });
      expect(configured?.expected).toBe(10);
      expect(configured?.row.metadata).toMatchObject({
        case: "configured-span",
        scenario: "wrap-vitest-suite-traces",
        testRunId,
      });
      expect(configured?.row.tags).toEqual(["math", "configured"]);
      expect(configured?.scores).toMatchObject({
        correctness: 1,
        pass: 1,
        quality: 0.9,
      });
      expect(configured?.output).toMatchObject({
        phase: "configured-span",
        result: 10,
      });

      expect(concurrentAlpha?.output).toMatchObject({
        phase: "concurrent-alpha",
      });
      expect(concurrentBeta?.output).toMatchObject({
        phase: "concurrent-beta",
      });

      expect(expectedFailure?.scores).toMatchObject({
        pass: 0,
      });

      expect(
        normalizeForSnapshot(
          [
            simplePass,
            configured,
            concurrentAlpha,
            concurrentBeta,
            expectedFailure,
          ].map((event) =>
            summarizeWrapperContract(event!, ["case", "scenario", "testRunId"]),
          ) as Json,
        ),
      ).toMatchSnapshot("span-events");

      expect(
        normalizeForSnapshot(
          payloadRowsForTestRunId(payloads(), testRunId) as Json,
        ),
      ).toMatchSnapshot("log-payloads");
    },
  );
});
