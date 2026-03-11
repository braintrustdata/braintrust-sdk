import OpenAI from "openai-v5";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapOpenAIConversationTraces } from "./scenario.impl";

runMain(() => runWrapOpenAIConversationTraces(OpenAI, "5.11.0"));
