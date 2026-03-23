import Anthropic from "@anthropic-ai/sdk";
import { runMain } from "../../helpers/provider-runtime.mjs";
import { runAnthropicAutoInstrumentationNodeHook } from "./scenario.impl.mjs";

runMain(async () => runAnthropicAutoInstrumentationNodeHook(Anthropic));
