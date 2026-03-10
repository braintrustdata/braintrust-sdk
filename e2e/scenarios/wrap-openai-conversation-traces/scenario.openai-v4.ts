import OpenAI from "openai-v4";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapOpenAIConversationTraces } from "./scenario.impl";

runMain(() => runWrapOpenAIConversationTraces(OpenAI, "4.104.0"));
