import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/provider-runtime.mjs";
import { runOpenAIScenario } from "../../helpers/openai-scenario.mjs";

export { getInstalledPackageVersion };

export async function runOpenAIAutoInstrumentationNodeHook(
  OpenAI,
  openaiSdkVersion,
  chatHelperNamespace,
) {
  await runOpenAIScenario({
    OpenAI,
    chatHelperNamespace,
    openaiSdkVersion,
    projectNameBase: "e2e-openai-auto-instrumentation-hook",
    rootName: "openai-auto-hook-root",
    scenarioName: "openai-auto-instrumentation-node-hook",
  });
}

export function runOpenAIAutoInstrumentationNodeHookOrExit(
  OpenAI,
  openaiSdkVersion,
  chatHelperNamespace,
) {
  runMain(async () =>
    runOpenAIAutoInstrumentationNodeHook(
      OpenAI,
      openaiSdkVersion,
      chatHelperNamespace,
    ),
  );
}
