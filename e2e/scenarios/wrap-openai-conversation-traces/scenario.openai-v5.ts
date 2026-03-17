import OpenAI from "openai-v5";
import {
  getInstalledPackageVersion,
  runMain,
} from "../../helpers/scenario-runtime";
import { runWrapOpenAIConversationTraces } from "./scenario.impl";

runMain(async () =>
  runWrapOpenAIConversationTraces(
    OpenAI,
    await getInstalledPackageVersion(import.meta.url, "openai-v5"),
    "ga",
  ),
);
