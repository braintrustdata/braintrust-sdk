import { SpanTypeAttribute } from "@braintrust/core";
import {
  CompiledPrompt,
  Span,
  StartSpanArgs,
  startSpan,
  traced,
} from "../logger";
import { getCurrentUnixTimestamp, isEmpty } from "../util";
import { mergeDicts } from "@braintrust/core";
import { parse } from "path";

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
  C extends StreamingChatResponse,
>(completion: (params: P) => C): (params: P) => Promise<any> {
  return (allParams: P & SpanInfo) => {
    const { span_info: _, ...params } = allParams;
    const span = startSpan(
      mergeDicts(
        {
          name: "Chat Completion",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
        },
        parseChatCompletionParams(allParams),
      ),
    );
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
        output: completion.choices,
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
type EnhancedResponse = {
  response: Response;
  data: any;
};

interface APIPromise<T> extends Promise<T> {
  withResponse(): Promise<EnhancedResponse>;
}

export const X_CACHED_HEADER = "x-cached";
export function parseCachedHeader(
  value: string | null | undefined,
): number | undefined {
  return isEmpty(value) ? undefined : value.toLowerCase() === "true" ? 1 : 0;
}

function logHeaders(response: Response, span: Span) {
  const cachedHeader = response.headers.get(X_CACHED_HEADER);
  if (isEmpty(cachedHeader)) {
    return;
  }
  span.log({
    metrics: {
      cached: parseCachedHeader(cachedHeader),
    },
  });
}

function wrapChatCompletion<
  P extends ChatParams,
  C extends NonStreamingChatResponse | StreamingChatResponse,
>(
  completion: (params: P, options?: unknown) => APIPromise<C>,
): (params: P, options?: unknown) => Promise<any> {
  return async (allParams: P & SpanInfo, options?: unknown) => {
    const { span_info: _, ...params } = allParams;
    const span = startSpan(
      mergeDicts(
        {
          name: "Chat Completion",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
        },
        parseChatCompletionParams(allParams),
      ),
    );
    const startTime = getCurrentUnixTimestamp();
    if (params.stream) {
      const { data: ret, response } = await completion(
        // We could get rid of this type coercion if we could somehow enforce
        // that `P extends ChatParams` BUT does not have the property
        // `span_info`.
        params as P,
        options,
      ).withResponse();
      logHeaders(response, span);
      const wrapperStream = new WrapperStream(span, startTime, ret.iterator());
      ret.iterator = () => wrapperStream[Symbol.asyncIterator]();
      return ret;
    } else {
      try {
        const { data: ret, response } = await (
          completion(
            params as P,
            options,
          ) as APIPromise<NonStreamingChatResponse>
        ).withResponse();
        logHeaders(response, span);
        const { messages, ...rest } = params;
        span.log({
          input: messages,
          metadata: {
            ...rest,
          },
          output: ret.choices,
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

function parseChatCompletionParams<P extends ChatParams>(
  allParams: P & SpanInfo,
): StartSpanArgs {
  const { span_info, ...params } = allParams;
  const { metadata: spanInfoMetadata, ...spanInfoRest } = span_info ?? {};
  let ret: StartSpanArgs = {
    ...spanInfoRest,
    event: {
      metadata: spanInfoMetadata,
    },
  };
  const { messages, ...paramsRest } = params;
  return mergeDicts(ret, { event: { input: messages, metadata: paramsRest } });
}

type EmbeddingCreateParams = {
  input: string;
};

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
  C extends CreateEmbeddingResponse,
>(
  create: (params: P, options?: unknown) => APIPromise<C>,
): (params: P & SpanInfo, options?: unknown) => Promise<any> {
  return async (allParams: P & SpanInfo, options?: unknown) => {
    const { span_info: _, ...params } = allParams;
    return traced(
      async (span) => {
        // We could get rid of this type coercion if we could somehow enforce
        // that `P extends EmbeddingCreateParams` BUT does not have the property
        // `span_info`.
        const { data: result, response } = await create(
          params as P,
          options,
        ).withResponse();
        logHeaders(response, span);
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
      mergeDicts(
        {
          name: "Embedding",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
        },
        parseEmbeddingParams(allParams),
      ),
    );
  };
}

function parseEmbeddingParams<P extends EmbeddingCreateParams>(
  allParams: P & SpanInfo,
): StartSpanArgs {
  const { span_info, ...params } = allParams;
  const { metadata: spanInfoMetadata, ...spanInfoRest } = span_info ?? {};
  let ret: StartSpanArgs = {
    ...spanInfoRest,
    event: {
      metadata: spanInfoMetadata,
    },
  };
  const { input, ...paramsRest } = params;
  return mergeDicts(ret, { event: { input, metadata: paramsRest } });
}

function postprocessStreamingResults(allResults: any[]): {
  output: [
    {
      index: number;
      message: any;
      logprobs: null;
      finish_reason?: string;
    },
  ];
  metrics: Record<string, number>;
} {
  let role = undefined;
  let content = undefined;
  let tool_calls = undefined;
  let finish_reason = undefined;
  let metrics = {};
  for (const result of allResults) {
    if (result.usage) {
      metrics = {
        ...metrics,
        tokens: result.usage.total_tokens,
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
      };
    }

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

  return {
    metrics,
    output: [
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
    ],
  };
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
        ...postprocessStreamingResults(allResults),
      });
    } finally {
      this.span.end();
    }
  }
}
