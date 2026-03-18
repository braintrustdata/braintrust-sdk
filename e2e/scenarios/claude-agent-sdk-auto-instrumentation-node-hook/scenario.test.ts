import { expect, test } from "vitest";
import { assertClaudeAgentSDKTraceContract } from "../../helpers/claude-agent-sdk-trace-contract";
import {
  isCanaryMode,
  prepareScenarioDir,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 120_000;

test("claude agent sdk auto-instrumentation via node hook collects the shared claude agent trace contract", async () => {
  await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
    await runNodeScenarioDir({
      nodeArgs: ["--import", "braintrust/hook.mjs"],
      scenarioDir,
      timeoutMs: TIMEOUT_MS,
    });

    const contract = assertClaudeAgentSDKTraceContract({
      capturedEvents: events(),
      rootName: "claude-agent-sdk-auto-hook-root",
      scenarioName: "claude-agent-sdk-auto-instrumentation-node-hook",
    });

    if (!isCanaryMode()) {
      expect(contract.spanSummary).toMatchSnapshot("span-events");
    }
  });
});
