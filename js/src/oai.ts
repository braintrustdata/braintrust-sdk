import { SpanTypeAttribute } from "@braintrust/core";
import { CompiledPrompt, Span, startSpan, traced } from "./logger";
import { getCurrentUnixTimestamp } from "./util";
import { mergeDicts } from "@braintrust/core";

interface BetaLike {
  chat: {
    completions: {
      stream: any;
    };
  };
  embeddings: any;
}
interface ChatLike {
  completions: any;
}

interface OpenAILike {
  chat: ChatLike;
  embeddings: any;
  beta?: BetaLike;
}

declare global {
  var __inherited_braintrust_wrap_openai: ((openai: any) => any) | undefined;
}

/**
 * Wrap an `OpenAI` object (created with `new OpenAI(...)`) to add tracing. If Braintrust is
 * not configured, this is a no-op
 *
 * Currently, this only supports the `v4` API.
 *
 * @param openai
 * @returns The wrapped `OpenAI` object.
 */
export function wrapOpenAI<T extends object>(openai: T): T {
  if ((openai as any)?.chat?.completions?.create) {
    return wrapOpenAIv4(openai as any) as T;
  } else {
    console.warn("Unsupported OpenAI library (potentially v3). Not wrapping.");
    return openai;
  }
}
globalThis.__inherited_braintrust_wrap_openai = wrapOpenAI;

export function wrapOpenAIv4<T extends OpenAILike>(openai: T): T {
  let completionProxy = new Proxy(openai.chat.completions, {
    get(target, name, receiver) {
      const baseVal = Reflect.get(target, name, receiver);
      if (name === "create") {
        return wrapChatCompletion(baseVal.bind(target));
      }
      return baseVal;
    },
  });
  let chatProxy = new Proxy(openai.chat, {
    get(target, name, receiver) {
      if (name === "completions") {
        return completionProxy;
      }
      return Reflect.get(target, name, receiver);
    },
  });

  let embeddingProxy = new Proxy(openai.embeddings, {
    get(target, name, receiver) {
      const baseVal = Reflect.get(target, name, receiver);
      if (name === "create") {
        return wrapEmbeddings(baseVal.bind(target));
      }
      return baseVal;
    },
  });

  let betaProxy: OpenAILike;
  if (openai.beta?.chat?.completions?.stream) {
    let betaChatCompletionProxy = new Proxy(openai?.beta?.chat.completions, {
      get(target, name, receiver) {
        const baseVal = Reflect.get(target, name, receiver);
        if (name === "stream") {
          return wrapBetaChatCompletion(baseVal.bind(target));
        }
        return baseVal;
      },
    });
    let betaChatProxy = new Proxy(openai.beta.chat, {
      get(target, name, receiver) {
        if (name === "completions") {
          return betaChatCompletionProxy;
        }
        return Reflect.get(target, name, receiver);
      },
    });
    betaProxy = new Proxy(openai.beta, {
      get(target, name, receiver) {
        if (name === "chat") {
          return betaChatProxy;
        }
        return Reflect.get(target, name, receiver);
      },
    });
  }
  let proxy = new Proxy(openai, {
    get(target, name, receiver) {
      if (name === "chat") {
        return chatProxy;
      }
      if (name === "embeddings") {
        return embeddingProxy;
      }
      if (name === "beta" && betaProxy) {
        return betaProxy;
      }
      return Reflect.get(target, name, receiver);
    },
  });

  return proxy;
}

type SpanInfo = {
  span_info?: CompiledPrompt<"chat">["span_info"];
};

type ChatParams = {
  messages: unknown;
  stream?: boolean | null;
};

interface NonStreamingChatResponse {
  choices: any[];
  usage:
    | {
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
      }
    | undefined;
}

function wrapBetaChatCompletion<
  P extends ChatParams,
  C extends StreamingChatResponse
>(completion: (params: P) => C): (params: P) => Promise<any> {
  return (allParams: P & SpanInfo) => {
    const { span_info, ...params } = allParams;
    const { messages, ...rest } = params;
    const span = startSpan({
      name: "OpenAI Chat Completion",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: mergeDicts(
        {
          input: messages,
          metadata: {
            ...rest,
          },
        },
        span_info || {}
      ),
    });
    const startTime = getCurrentUnixTimestamp();

    const ret = completion(params as P) as StreamingChatResponse;

    let first = true;
    ret.on("chunk", (_chunk: any) => {
      if (first) {
        const now = getCurrentUnixTimestamp();
        span.log({
          metrics: {
            time_to_first_token: now - startTime,
          },
        });
        first = false;
      }
    });
    ret.on("chatCompletion", (completion: any) => {
      span.log({
        output: completion.choices[0],
      });
    });
    ret.on("end", () => {
      span.end();
    });

    return ret;
  };
}

// TODO: Mock this up better
type StreamingChatResponse = any;

function wrapChatCompletion<
  P extends ChatParams,
  C extends NonStreamingChatResponse | StreamingChatResponse
>(
  completion: (params: P, options?: unknown) => Promise<C>
): (params: P, options?: unknown) => Promise<any> {
  return async (allParams: P & SpanInfo, options?: unknown) => {
    const { span_info, ...params } = allParams;
    const { messages, ...rest } = params;
    const span = startSpan({
      name: "OpenAI Chat Completion",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: mergeDicts(
        {
          input: messages,
          metadata: {
            ...rest,
          },
        },
        span_info || {}
      ),
    });
    const startTime = getCurrentUnixTimestamp();
    if (params.stream) {
      const ret = (await completion(
        params as P,
        options
      )) as StreamingChatResponse;
      const wrapperStream = new WrapperStream(span, startTime, ret.iterator());
      ret.iterator = () => wrapperStream[Symbol.asyncIterator]();
      return ret;
    } else {
      try {
        const ret = (await completion(
          params as P,
          options
        )) as NonStreamingChatResponse;
        const { messages, ...rest } = params;
        span.log({
          input: messages,
          metadata: {
            ...rest,
          },
          output: ret.choices[0],
          metrics: {
            time_to_first_token: getCurrentUnixTimestamp() - startTime,
            tokens: ret.usage?.total_tokens,
            prompt_tokens: ret.usage?.prompt_tokens,
            completion_tokens: ret.usage?.completion_tokens,
          },
        });
        return ret;
      } finally {
        span.end();
      }
    }
  };
}

type EmbeddingCreateParams = {
  input: string;
} & SpanInfo;

type CreateEmbeddingResponse = {
  data: { embedding: Array<number> }[];
  usage:
    | {
        total_tokens: number;
        prompt_tokens: number;
      }
    | undefined;
};

function wrapEmbeddings<
  P extends EmbeddingCreateParams,
  C extends CreateEmbeddingResponse
>(
  create: (params: P, options?: unknown) => Promise<C>
): (params: P, options?: unknown) => Promise<any> {
  return async (allParams: P, options?: unknown) => {
    const { span_info, ...params } = allParams;
    const { input, ...rest } = params;
    return traced(
      async (span) => {
        const result = await create(params as P, options);
        const embedding_length = result.data[0].embedding.length;
        span.log({
          // TODO: Add a flag to control whether to log the full embedding vector,
          // possibly w/ JSON compression.
          output: { embedding_length },
          metrics: {
            tokens: result.usage?.total_tokens,
            prompt_tokens: result.usage?.prompt_tokens,
          },
        });

        return result;
      },
      {
        name: "OpenAI Embedding",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: mergeDicts(
          {
            input,
            metadata: {
              ...rest,
            },
          },
          span_info || {}
        ),
      }
    );
  };
}

function postprocessStreamingResults(allResults: any[]): [
  {
    index: number;
    message: any;
    logprobs: null;
    finish_reason?: string;
  }
] {
  let role = undefined;
  let content = undefined;
  let tool_calls = undefined;
  let finish_reason = undefined;
  for (const result of allResults) {
    const delta = result.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }

    if (!role && delta.role) {
      role = delta.role;
    }

    if (delta.finish_reason) {
      finish_reason = delta.finish_reason;
    }

    if (delta.content) {
      content = (content || "") + delta.content;
    }

    if (delta.tool_calls) {
      if (!tool_calls) {
        tool_calls = [
          {
            id: delta.tool_calls[0].id,
            type: delta.tool_calls[0].type,
            function: delta.tool_calls[0].function,
          },
        ];
      } else {
        tool_calls[0].function.arguments +=
          delta.tool_calls[0].function.arguments;
      }
    }
  }

  return [
    {
      index: 0,
      message: {
        role,
        content,
        tool_calls,
      },
      logprobs: null,
      finish_reason,
    },
  ];
}

class WrapperStream<Item> implements AsyncIterable<Item> {
  private span: Span;
  private iter: AsyncIterable<Item>;
  private startTime: number;

  constructor(span: Span, startTime: number, iter: AsyncIterable<Item>) {
    this.span = span;
    this.iter = iter;
    this.startTime = startTime;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item, any, undefined> {
    let first = true;
    let allResults = [];
    try {
      for await (const item of this.iter) {
        if (first) {
          const now = getCurrentUnixTimestamp();
          this.span.log({
            metrics: {
              time_to_first_token: now - this.startTime,
            },
          });
          first = false;
        }

        allResults.push(item);
        yield item;
      }
      this.span.log({
        output: postprocessStreamingResults(allResults),
      });
    } finally {
      this.span.end();
    }
  }
}
