import Anthropic from "@anthropic-ai/sdk";
import { runAnthropicScenario } from "../../helpers/anthropic-scenario.mjs";
import { runMain } from "../../helpers/provider-runtime.mjs";

runMain(async () =>
  runAnthropicScenario({
    Anthropic,
    projectNameBase: "e2e-anthropic-auto-instrumentation-hook",
    rootName: "anthropic-wrapper-root",
    scenarioName: "wrap-anthropic-message-traces",
    testImageUrl: new URL("./test-image.png", import.meta.url),
    useMessagesStreamHelper: false,
  }),
);
