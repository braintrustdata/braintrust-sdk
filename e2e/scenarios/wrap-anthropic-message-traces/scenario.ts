import Anthropic from "@anthropic-ai/sdk";
import { runMain } from "../../helpers/scenario-runtime";
import { runWrapAnthropicMessageTraces } from "./scenario.impl.mjs";

runMain(async () => runWrapAnthropicMessageTraces(Anthropic));
