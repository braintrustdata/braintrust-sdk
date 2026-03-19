import * as chatOpenAI from "@langchain/openai";
import * as prompts from "@langchain/core/prompts";
import * as messages from "@langchain/core/messages";
import * as tools from "@langchain/core/tools";
import * as braintrustLangchain from "@braintrust/langchain-js";
import * as zod from "zod";
import { runLangchainScenario } from "../../helpers/langchain-scenario.mjs";
import { runMain } from "../../helpers/scenario-runtime";

runMain(async () =>
  runLangchainScenario({
    braintrustLangchain,
    chatOpenAI,
    messages,
    projectNameBase: "e2e-wrap-langchain",
    prompts,
    rootName: "langchain-wrapper-root",
    scenarioName: "wrap-langchain-js-traces",
    tools,
    zod,
  }),
);
