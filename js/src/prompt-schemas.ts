import type {
  ChatCompletionMessageParam,
  ModelParams,
  PromptData,
  ToolFunctionDefinition,
} from "./sdk-types";

export type PromptDefinition = (
  | { prompt: string }
  | { messages: ChatCompletionMessageParam[] }
) & {
  model: string;
  params?: ModelParams;
  templateFormat?: "mustache" | "nunjucks" | "none";
  environments?: string[];
};

export type PromptDefinitionWithTools = PromptDefinition & {
  tools?: ToolFunctionDefinition[];
};

export function promptDefinitionToPromptData(
  promptDefinition: PromptDefinition,
  rawTools?: ToolFunctionDefinition[],
): PromptData {
  let promptBlock: PromptData["prompt"];
  if ("messages" in promptDefinition) {
    promptBlock = {
      type: "chat",
      messages: promptDefinition.messages,
      tools:
        rawTools && rawTools.length > 0 ? JSON.stringify(rawTools) : undefined,
    };
  } else {
    promptBlock = {
      type: "completion",
      content: promptDefinition.prompt,
    };
  }

  return {
    prompt: promptBlock,
    options: {
      model: promptDefinition.model,
      params: promptDefinition.params,
    },
    ...(promptDefinition.templateFormat
      ? { template_format: promptDefinition.templateFormat }
      : {}),
  };
}
