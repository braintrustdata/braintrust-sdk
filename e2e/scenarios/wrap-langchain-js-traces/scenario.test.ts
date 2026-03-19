import { expect, test } from "vitest";
import { assertLangchainTraceContract } from "../../helpers/langchain-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import { E2E_TAGS } from "../../helpers/tags";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;

test(
  "wrap-langchain-js-traces captures invoke, chain, stream, and tool spans via BraintrustCallbackHandler",
  {
    tags: [E2E_TAGS.externalApi],
    timeout: TIMEOUT_MS,
  },
  async () => {
    await withScenarioHarness(async ({ events, payloads, runScenarioDir }) => {
      await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });

      const contract = assertLangchainTraceContract({
        capturedEvents: events(),
        payloads: payloads(),
        rootName: "langchain-wrapper-root",
        scenarioName: "wrap-langchain-js-traces",
      });

      if (!isCanaryMode()) {
        expect(contract.spanSummary).toMatchSnapshot("span-events");
        expect(contract.payloadSummary).toMatchSnapshot("log-payloads");
      }
    });
  },
);
