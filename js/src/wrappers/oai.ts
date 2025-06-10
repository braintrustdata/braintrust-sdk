/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { responsesProxy, parseMetricsFromUsage } from "./oai_responses";

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
  moderations: any;
  beta?: BetaLike;
  responses?: any;
}

declare global {
  // eslint-disable-next-line no-var, @typescript-eslint/no-explicit-any
  var __inherited_braintrust_wrap_openai: ((openai: any) => any) | undefined;
}

/**
 * Wrap an `OpenAI` object (created with `new OpenAI(...)`) to add tracing. If Braintrust is
 * not configured, nothing will be traced. If this is not an `OpenAI` object, this function is
 * a no-op.
 *
 * Currently, this only supports the `v4` API.
 *
 * @param openai
 * @returns The wrapped `OpenAI` object.
 */
export function wrapOpenAI<T extends object>(openai: T): T {
  const oai: unknown = openai;
  if (
    oai &&
    typeof oai === "object" &&
    "chat" in oai &&
    typeof oai.chat === "object" &&
    oai.chat &&
    "completions" in oai.chat &&
    typeof oai.chat.completions === "object" &&
    oai.chat.completions &&
    "create" in oai.chat.completions
  ) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return wrapOpenAIv4(oai as OpenAILike) as T;
  } else {
    console.warn("Unsupported OpenAI library (potentially v3). Not wrapping.");
    return openai;
  }
}
globalThis.__inherited_braintrust_wrap_openai = wrapOpenAI;

export function wrapOpenAIv4<T extends OpenAILike>(openai: T): T {
  const completionProxy = createEndpointProxy(
    openai.chat.completions,
    wrapChatCompletion,
  );

  const chatProxy = new Proxy(openai.chat, {
    get(target, name, receiver) {
      if (name === "completions") {
        return completionProxy;
      }
      return Reflect.get(target, name, receiver);
    },
  });

  const embeddingProxy = createEndpointProxy<
    EmbeddingCreateParams,
    CreateEmbeddingResponse
  >(openai.embeddings, wrapEmbeddings);
  const moderationProxy = createEndpointProxy<
    ModerationCreateParams,
    CreateModerationResponse
  >(openai.moderations, wrapModerations);

  let betaProxy: BetaLike;
  if (openai.beta?.chat?.completions?.stream) {
    const betaChatCompletionProxy = new Proxy(openai?.beta?.chat.completions, {
      get(target, name, receiver) {
        const baseVal = Reflect.get(target, name, receiver);
        if (name === "parse") {
          return wrapBetaChatCompletionParse(baseVal.bind(target));
        } else if (name === "stream") {
          return wrapBetaChatCompletionStream(baseVal.bind(target));
        }
        return baseVal;
      },
    });
    const betaChatProxy = new Proxy(openai.beta.chat, {
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

  return new Proxy(openai, {
    get(target, name, receiver) {
      switch (name) {
        case "chat":
          return chatProxy;
        case "embeddings":
          return embeddingProxy;
        case "moderations":
          return moderationProxy;
        case "responses":
          return responsesProxy(openai);
      }

      if (name === "beta" && betaProxy) {
        return betaProxy;
      }
      return Reflect.get(target, name, receiver);
    },
  });
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

function logCompletionResponse(
  startTime: number,
  response: NonStreamingChatResponse | StreamingChatResponse,
  span: Span,
) {
  const metrics = parseMetricsFromUsage(response?.usage);
  metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
  span.log({
    output: response.choices,
    metrics: metrics,
  });
}

function wrapBetaChatCompletionParse<
  P extends ChatParams,
  C extends Promise<NonStreamingChatResponse>,
>(completion: (params: P) => C): (params: P) => Promise<any> {
  return async (allParams: P & SpanInfo) => {
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const ret = await completion(params as P);
    try {
      logCompletionResponse(startTime, ret, span);
      return ret;
    } finally {
      span.end();
    }
  };
}

function wrapBetaChatCompletionStream<
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

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

export const LEGACY_CACHED_HEADER = "x-cached";
export const X_CACHED_HEADER = "x-bt-cached";
export function parseCachedHeader(
  value: string | null | undefined,
): number | undefined {
  return isEmpty(value)
    ? undefined
    : ["true", "hit"].includes(value.toLowerCase())
      ? 1
      : 0;
}

function logHeaders(response: Response, span: Span) {
  const cachedHeader = response.headers.get(X_CACHED_HEADER);
  if (isEmpty(cachedHeader)) {
    const legacyCacheHeader = response.headers.get(LEGACY_CACHED_HEADER);
    if (!isEmpty(legacyCacheHeader)) {
      span.log({
        metrics: {
          cached: parseCachedHeader(legacyCacheHeader),
        },
      });
    }
  } else {
    span.log({
      metrics: {
        cached: parseCachedHeader(cachedHeader),
      },
    });
  }
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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        params as P,
        options,
      ).withResponse();
      logHeaders(response, span);
      const wrapperStream = new WrapperStream(span, startTime, ret.iterator());
      ret.iterator = () => wrapperStream[Symbol.asyncIterator]();
      return ret;
    } else {
      try {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const completionResponse = completion(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          params as P,
          options,
        ) as APIPromise<NonStreamingChatResponse>;
        const { data: ret, response } = await completionResponse.withResponse();
        logHeaders(response, span);
        const { messages, ...rest } = params;
        span.log({
          input: messages,
          metadata: {
            ...rest,
          },
        });
        logCompletionResponse(startTime, ret, span);
        return ret;
      } finally {
        span.end();
      }
    }
  };
}

function parseBaseParams<T extends Record<string, any>>(
  allParams: T & SpanInfo,
  inputField: string,
): StartSpanArgs {
  const { span_info, ...params } = allParams;
  const { metadata: spanInfoMetadata, ...spanInfoRest } = span_info ?? {};
  const ret: StartSpanArgs = {
    ...spanInfoRest,
    event: {
      metadata: spanInfoMetadata,
    },
  };
  const input = params[inputField];
  const paramsRest = { ...params, provider: "openai" };
  delete paramsRest[inputField];
  return mergeDicts(ret, { event: { input, metadata: paramsRest } });
}

function createApiWrapper<T, R>(
  name: string,
  create: (
    params: Omit<T & SpanInfo, "span_info">,
    options?: unknown,
  ) => APIPromise<R>,
  processResponse: (result: R, span: Span) => void,
  parseParams: (params: T & SpanInfo) => StartSpanArgs,
): (params: T & SpanInfo, options?: unknown) => Promise<any> {
  return async (allParams: T & SpanInfo, options?: unknown) => {
    const { span_info: _, ...params } = allParams;
    return traced(
      async (span) => {
        const { data: result, response } = await create(
          params,
          options,
        ).withResponse();
        logHeaders(response, span);
        processResponse(result, span);
        return result;
      },
      mergeDicts(
        {
          name,
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
        },
        parseParams(allParams),
      ),
    );
  };
}

function createEndpointProxy<T, R>(
  target: any,
  wrapperFn: (
    create: (params: T, options?: unknown) => APIPromise<R>,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  ) => Function,
) {
  return new Proxy(target, {
    get(target, name, receiver) {
      const baseVal = Reflect.get(target, name, receiver);
      if (name === "create") {
        return wrapperFn(baseVal.bind(target));
      }
      return baseVal;
    },
  });
}

function parseChatCompletionParams(params: ChatParams): StartSpanArgs {
  return parseBaseParams(params, "messages");
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

function processEmbeddingResponse(result: CreateEmbeddingResponse, span: Span) {
  span.log({
    output: { embedding_length: result.data[0].embedding.length },
    metrics: parseMetricsFromUsage(result?.usage),
  });
}

type ModerationCreateParams = {
  input: string;
};

type CreateModerationResponse = {
  results: Array<any>;
};

function processModerationResponse(
  result: CreateModerationResponse,
  span: Span,
) {
  span.log({
    output: result.results,
  });
}

const wrapEmbeddings = (
  create: (
    params: EmbeddingCreateParams,
    options?: unknown,
  ) => APIPromise<CreateEmbeddingResponse>,
) =>
  createApiWrapper<EmbeddingCreateParams, CreateEmbeddingResponse>(
    "Embedding",
    create,
    processEmbeddingResponse,
    (params) => parseBaseParams(params, "input"),
  );

const wrapModerations = (
  create: (
    params: ModerationCreateParams,
    options?: unknown,
  ) => APIPromise<CreateModerationResponse>,
) =>
  createApiWrapper<ModerationCreateParams, CreateModerationResponse>(
    "Moderation",
    create,
    processModerationResponse,
    (params) => parseBaseParams(params, "input"),
  );

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
      // NOTE: only included if `stream_options.include_usage` is true
      metrics = {
        ...metrics,
        ...parseMetricsFromUsage(result?.usage),
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
      const toolDelta = delta.tool_calls[0];
      if (
        !tool_calls ||
        (toolDelta.id && tool_calls[tool_calls.length - 1].id !== toolDelta.id)
      ) {
        tool_calls = [
          ...(tool_calls || []),
          {
            id: toolDelta.id,
            type: toolDelta.type,
            function: toolDelta.function,
          },
        ];
      } else {
        tool_calls[tool_calls.length - 1].function.arguments +=
          toolDelta.function.arguments;
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
    const allResults: Item[] = [];
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
