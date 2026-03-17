import OpenAI from "openai";
import {
  getInstalledPackageVersion,
  runOpenAIAutoInstrumentationNodeHookOrExit,
} from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(
  OpenAI,
  await getInstalledPackageVersion(import.meta.url, "openai"),
);
