import OpenAI from "openai";
import { runOpenAIAutoInstrumentationNodeHookOrExit } from "./scenario.impl.mjs";

runOpenAIAutoInstrumentationNodeHookOrExit(OpenAI, "6.25.0");
