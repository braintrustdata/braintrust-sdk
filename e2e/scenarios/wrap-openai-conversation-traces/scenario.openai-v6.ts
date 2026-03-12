import OpenAI from "openai";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapOpenAIConversationTraces } from "./scenario.impl";

runMain(() => runWrapOpenAIConversationTraces(OpenAI, "6.25.0", "ga"));
