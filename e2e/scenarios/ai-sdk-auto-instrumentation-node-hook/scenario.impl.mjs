import { runMain } from "../../helpers/provider-runtime.mjs";
import { runAISDKScenario } from "../../helpers/ai-sdk-scenario.mjs";
import { z } from "zod";

export async function runAISDKAutoInstrumentationNodeHook(options) {
  await runAISDKScenario({
    ...options,
    flushCount: 2,
    flushDelayMs: 100,
    projectNameBase: "e2e-ai-sdk-auto-instrumentation-hook",
    rootName: "ai-sdk-auto-hook-root",
    scenarioName: "ai-sdk-auto-instrumentation-node-hook",
    zod: z,
  });
}

export function runAISDKAutoInstrumentationNodeHookOrExit(options) {
  runMain(async () => runAISDKAutoInstrumentationNodeHook(options));
}
