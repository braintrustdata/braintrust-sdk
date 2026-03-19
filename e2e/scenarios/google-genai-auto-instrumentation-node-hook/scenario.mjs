import * as googleGenAI from "@google/genai";
import { runGoogleGenAIScenario } from "../../helpers/google-genai-scenario.mjs";
import { runMain } from "../../helpers/provider-runtime.mjs";

runMain(async () =>
  runGoogleGenAIScenario({
    projectNameBase: "e2e-google-genai-auto-instrumentation-hook",
    rootName: "google-genai-auto-hook-root",
    scenarioName: "google-genai-auto-instrumentation-node-hook",
    sdk: googleGenAI,
    testImageUrl: new URL("./test-image.png", import.meta.url),
  }),
);
