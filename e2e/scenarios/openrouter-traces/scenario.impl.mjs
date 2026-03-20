import { tool } from "@openrouter/sdk";
import { wrapOpenRouter } from "braintrust";
import { z } from "zod";
import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/provider-runtime.mjs";
import { runOpenRouterScenario } from "../../helpers/openrouter-scenario.mjs";

export { getInstalledPackageVersion };

function createWeatherTool() {
  return tool({
    name: "lookup_weather",
    description: "Look up the weather forecast for a city.",
    inputSchema: z.object({
      city: z.string(),
    }),
    outputSchema: z.object({
      forecast: z.string(),
    }),
    execute: async ({ city }) => ({
      forecast: `Sunny in ${city}`,
    }),
  });
}

export async function runWrapOpenRouterTraces(
  OpenRouter,
  openrouterSdkVersion,
) {
  await runOpenRouterScenario({
    OpenRouter,
    createWeatherTool,
    decorateClient: wrapOpenRouter,
    openrouterSdkVersion,
    projectNameBase: "e2e-wrap-openrouter",
    rootName: "openrouter-wrapper-root",
    scenarioName: "openrouter-traces",
  });
}

export async function runOpenRouterAutoInstrumentationNodeHook(
  OpenRouter,
  openrouterSdkVersion,
) {
  await runOpenRouterScenario({
    OpenRouter,
    createWeatherTool,
    openrouterSdkVersion,
    projectNameBase: "e2e-openrouter-auto-instrumentation-hook",
    rootName: "openrouter-auto-hook-root",
    scenarioName: "openrouter-traces",
  });
}

export function runOpenRouterAutoInstrumentationNodeHookOrExit(
  OpenRouter,
  openrouterSdkVersion,
) {
  runMain(async () =>
    runOpenRouterAutoInstrumentationNodeHook(OpenRouter, openrouterSdkVersion),
  );
}
