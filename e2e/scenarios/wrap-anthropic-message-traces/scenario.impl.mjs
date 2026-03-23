import { wrapAnthropic } from "braintrust";
import { runAnthropicScenario } from "../../helpers/anthropic-scenario.mjs";

const ROOT_NAME = "anthropic-wrapper-root";
const SCENARIO_NAME = "wrap-anthropic-message-traces";

export async function runWrapAnthropicMessageTraces(Anthropic) {
  await runAnthropicScenario({
    Anthropic,
    decorateClient: wrapAnthropic,
    projectNameBase: "e2e-wrap-anthropic",
    rootName: ROOT_NAME,
    scenarioName: SCENARIO_NAME,
    testImageUrl: new URL("./test-image.png", import.meta.url),
  });
}

export async function runAnthropicAutoInstrumentationNodeHook(Anthropic) {
  await runAnthropicScenario({
    Anthropic,
    projectNameBase: "e2e-anthropic-auto-instrumentation-hook",
    rootName: ROOT_NAME,
    scenarioName: SCENARIO_NAME,
    testImageUrl: new URL("./test-image.png", import.meta.url),
    useMessagesStreamHelper: false,
  });
}
