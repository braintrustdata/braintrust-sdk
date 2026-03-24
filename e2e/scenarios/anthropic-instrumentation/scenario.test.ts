import {
  prepareScenarioDir,
  resolveScenarioDir,
} from "../../helpers/scenario-harness";
import { defineAnthropicInstrumentationAssertions } from "./assertions";

const scenarioDir = await prepareScenarioDir({
  scenarioDir: resolveScenarioDir(import.meta.url),
});
const TIMEOUT_MS = 90_000;

defineAnthropicInstrumentationAssertions({
  name: "wrapped instrumentation",
  runScenario: async ({ runScenarioDir }) => {
    await runScenarioDir({ scenarioDir, timeoutMs: TIMEOUT_MS });
  },
  testFileUrl: import.meta.url,
  timeoutMs: TIMEOUT_MS,
});

defineAnthropicInstrumentationAssertions({
  name: "auto-hook instrumentation",
  runScenario: async ({ runNodeScenarioDir }) => {
    await runNodeScenarioDir({
      nodeArgs: ["--import", "braintrust/hook.mjs"],
      scenarioDir,
      timeoutMs: TIMEOUT_MS,
    });
  },
  testFileUrl: import.meta.url,
  timeoutMs: TIMEOUT_MS,
});
