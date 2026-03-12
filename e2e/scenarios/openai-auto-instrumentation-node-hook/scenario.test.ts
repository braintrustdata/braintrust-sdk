import { beforeAll, expect, test } from "vitest";
import { normalizeForSnapshot, type Json } from "../../helpers/normalize";
import {
  OPENAI_AUTO_HOOK_SCENARIOS,
  OPENAI_SCENARIO_TIMEOUT_MS,
  summarizeOpenAIContract,
} from "../../helpers/openai";
import {
  installScenarioDependencies,
  resolveScenarioDir,
  withScenarioHarness,
} from "../../helpers/scenario-harness";
import {
  findLatestChildSpan,
  findLatestSpan,
} from "../../helpers/trace-selectors";

const scenarioDir = resolveScenarioDir(import.meta.url);

beforeAll(async () => {
  await installScenarioDependencies({ scenarioDir });
});

for (const scenario of OPENAI_AUTO_HOOK_SCENARIOS) {
  test(`openai auto-instrumentation via node hook collects traces without manual wrapping (openai ${scenario.version})`, async () => {
    await withScenarioHarness(async ({ events, runNodeScenarioDir }) => {
      await runNodeScenarioDir({
        entry: scenario.entry,
        nodeArgs: ["--import", "braintrust/hook.mjs"],
        scenarioDir,
        timeoutMs: OPENAI_SCENARIO_TIMEOUT_MS,
      });

      const capturedEvents = events();
      const root = findLatestSpan(capturedEvents, "openai-auto-hook-root");
      const chatCompletion =
        findLatestChildSpan(capturedEvents, "Chat Completion", root?.span.id) ??
        findLatestSpan(capturedEvents, "Chat Completion");

      expect(root).toBeDefined();
      expect(root?.row.metadata).toMatchObject({
        openaiSdkVersion: scenario.version,
      });
      expect(chatCompletion).toBeDefined();
      expect(chatCompletion?.span.parentIds).toEqual([root?.span.id ?? ""]);
      expect(chatCompletion?.row.metadata).toMatchObject({
        provider: "openai",
      });
      expect(
        typeof (chatCompletion?.row.metadata as { model?: unknown } | undefined)
          ?.model,
      ).toBe("string");

      expect(
        normalizeForSnapshot(
          [root, chatCompletion].map((event) =>
            summarizeOpenAIContract(event!),
          ) as Json,
        ),
      ).toMatchSnapshot("span-events");
    });
  });
}
