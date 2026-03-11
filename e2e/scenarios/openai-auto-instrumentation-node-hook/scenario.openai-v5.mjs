import OpenAI from "openai-v5";
import { runOpenAIAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(OpenAI, "5.11.0");
