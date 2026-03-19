import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "braintrust";
import { runAnthropicScenario } from "../../helpers/anthropic-scenario.mjs";
import { runMain } from "../../helpers/scenario-runtime";

runMain(async () =>
  runAnthropicScenario({
    Anthropic,
    decorateClient: wrapAnthropic,
    projectNameBase: "e2e-wrap-anthropic",
    rootName: "anthropic-wrapper-root",
    scenarioName: "wrap-anthropic-message-traces",
    testImageUrl: new URL("./test-image.png", import.meta.url),
  }),
);
