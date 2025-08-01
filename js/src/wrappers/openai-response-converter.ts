/* eslint-disable @typescript-eslint/no-explicit-any */

// Types extracted from OpenAI SDK
interface ResponseOutputItem {
  type: string;
  content?: Array<{ type: string; text?: string; refusal?: string }>;
  id?: string;
  name?: string;
  arguments?: string;
}

interface OpenAIResponse {
  output: Array<ResponseOutputItem>;
  created_at: number;
  id: string;
  model: string;
  usage?: {
    output_tokens?: number;
    input_tokens?: number;
    total_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    input_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

interface ChatCompletionMessage {
  content: string | null;
  refusal: string | null;
  role: "assistant";
  tool_calls?: Array<{
    id: string;
    function: {
      arguments: string;
      name: string;
    };
    type: "function";
  }>;
}

interface ChatCompletion {
  choices: Array<{
    finish_reason: "tool_calls" | "stop";
    index: number;
    logprobs: null;
    message: ChatCompletionMessage;
  }>;
  created: number;
  id: string;
  model: string;
  object: "chat.completion";
  usage?: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
    completion_tokens_details: {
      reasoning_tokens: number | undefined;
    };
    prompt_tokens_details: {
      cached_tokens: number | undefined;
    };
  };
}

function chatCompletionMessageFromResponseOutput(
  output: Array<ResponseOutputItem>,
): ChatCompletionMessage {
  const messages = output.filter((i) => i.type === "message");
  const text = messages
    .map((m) => m.content?.filter((x) => x.type === "output_text"))
    .flat()
    .filter(Boolean);
  const refusals = messages
    .map((m) => m.content?.filter((x) => x.type === "refusal"))
    .flat()
    .filter(Boolean);
  const toolCalls = output.filter((i) => i.type === "function_call");
  return {
    content: text.length > 0 ? text.map((t) => t.text).join("") : null,
    refusal:
      refusals.length > 0 ? refusals.map((r) => r.refusal).join("") : null,
    role: "assistant",
    tool_calls:
      toolCalls.length > 0
        ? toolCalls.map((t) => ({
            id: t.id ?? "",
            function: {
              arguments: t.arguments ?? "",
              name: t.name ?? "",
            },
            type: "function" as const,
          }))
        : undefined,
  };
}

export function chatCompletionFromResponse(response: OpenAIResponse): ChatCompletion {
  return {
    choices: [
      {
        finish_reason: response.output.some((i) => i.type === "function_call")
          ? "tool_calls"
          : "stop",
        index: 0,
        logprobs: null,
        message: chatCompletionMessageFromResponseOutput(response.output),
      },
    ],
    created: response.created_at,
    id: response.id,
    model: response.model,
    object: "chat.completion",
    usage: response.usage
      ? {
          completion_tokens: response.usage.output_tokens ?? 0,
          prompt_tokens: response.usage.input_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? 0,
          completion_tokens_details: {
            reasoning_tokens:
              response.usage.output_tokens_details?.reasoning_tokens,
          },
          prompt_tokens_details: {
            cached_tokens: response.usage.input_tokens_details?.cached_tokens,
          },
        }
      : undefined,
  };
}