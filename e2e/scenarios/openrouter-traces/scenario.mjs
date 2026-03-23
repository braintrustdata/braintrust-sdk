import { OpenRouter } from "@openrouter/sdk";
import {
  getInstalledPackageVersion,
  runOpenRouterAutoInstrumentationNodeHookOrExit,
} from "./scenario.impl.mjs";

runOpenRouterAutoInstrumentationNodeHookOrExit(
  OpenRouter,
  await getInstalledPackageVersion(import.meta.url, "@openrouter/sdk"),
);
