import OpenAI from "openai-v4";
import {
  getInstalledPackageVersion,
  runOpenAIAutoInstrumentationNodeHookOrExit,
} from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(
  OpenAI,
  await getInstalledPackageVersion(import.meta.url, "openai-v4"),
  "beta",
);
