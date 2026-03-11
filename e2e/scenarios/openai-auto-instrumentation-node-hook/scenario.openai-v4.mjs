import OpenAI from "openai-v4";
import { runOpenAIAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(OpenAI, "4.104.0");
