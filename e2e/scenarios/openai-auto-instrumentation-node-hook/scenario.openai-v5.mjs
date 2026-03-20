import OpenAI from "openai-v5";
import {
  getInstalledPackageVersion,
  runOpenAIAutoInstrumentationNodeHookOrExit,
} from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(
  OpenAI,
  await getInstalledPackageVersion(import.meta.url, "openai-v5"),
  "ga",
);
