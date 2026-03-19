import * as googleGenAI from "@google/genai";
import { wrapGoogleGenAI } from "braintrust";
import { runGoogleGenAIScenario } from "../../helpers/google-genai-scenario.mjs";
import { runMain } from "../../helpers/scenario-runtime";

runMain(async () =>
  runGoogleGenAIScenario({
    decorateSDK: wrapGoogleGenAI,
    projectNameBase: "e2e-wrap-google-genai",
    rootName: "google-genai-wrapper-root",
    scenarioName: "wrap-google-genai-content-traces",
    sdk: googleGenAI,
    testImageUrl: new URL("./test-image.png", import.meta.url),
  }),
);
