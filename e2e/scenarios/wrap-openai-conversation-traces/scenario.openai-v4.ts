import OpenAI from "openai-v4";
import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/scenario-runtime";
import { runWrapOpenAIConversationTraces } from "./scenario.impl";

runMain(async () =>
  runWrapOpenAIConversationTraces(
    OpenAI,
    await getInstalledPackageVersion(import.meta.url, "openai-v4"),
    "beta",
  ),
);
