import { OpenRouter } from "@openrouter/sdk";
import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/scenario-runtime";
import { runWrapOpenRouterTraces } from "./scenario.impl.mjs";

runMain(async () =>
  runWrapOpenRouterTraces(
    OpenRouter,
    await getInstalledPackageVersion(import.meta.url, "@openrouter/sdk"),
  ),
);
