import { wrapOpenAI } from "braintrust";
import { runOpenAIScenario } from "../../helpers/openai-scenario.mjs";

type ChatHelperNamespace = "beta" | "ga";

export async function runWrapOpenAIConversationTraces(
  OpenAI: any,
  openaiSdkVersion: string,
  chatHelperNamespace: ChatHelperNamespace,
) {
  await runOpenAIScenario({
    OpenAI,
    chatHelperNamespace,
    decorateClient: wrapOpenAI,
    openaiSdkVersion,
    projectNameBase: "e2e-wrap-openai-conversation",
    rootName: "openai-wrapper-root",
    scenarioName: "wrap-openai-conversation-traces",
  });
}
