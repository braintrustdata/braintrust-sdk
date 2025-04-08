import { SpanTypeAttribute } from "@braintrust/core";
import {
  CompiledPrompt,
  Span,
  StartSpanArgs,
  startSpan,
  traced,
} from "../logger";
import { getCurrentUnixTimestamp, isEmpty, filterFrom } from "../util";
import { mergeDicts } from "@braintrust/core";
import { proxyCreate, TimedSpan } from "./wrapper_utils";

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

function responsesProxy(openai: OpenAILike) {
  // This was added in v4.87.0 of the openai-node library
  if (!openai.responses) {
    return openai;
  }

  return new Proxy(openai.responses, {
    get(target, name, receiver) {
      if (name === "create") {
        return responsesCreateProxy(target.create.bind(target));
      } else if (name === "stream") {
        return responsesStreamProxy(target.stream.bind(target));
      }
      return Reflect.get(target, name, receiver);
    },
  });
}

function responsesCreateProxy(target: any): (params: any) => Promise<any> {
  const hooks = {
    name: "openai.responses",
    toSpanFunc: parseSpanFromResponseCreateParams,
    resultToEventFunc: parseEventFromResponseCreateResult,
    traceStreamFunc: traceResponseCreateStream,
  };

  return proxyCreate(target, hooks);
}

// convert response.create params into a span
function parseSpanFromResponseCreateParams(params: any): TimedSpan {
  // responses.create is meant to take a single message and instruction.
  // Convert that to the form our backend expects.
  let input = params.input;
  if (params.instructions) {
    input = [
      { role: "user", content: input },
      { role: "system", content: params.instructions },
    ];
  }

  const spanArgs = {
    name: "openai.responses.create",
    spanAttributes: {
      type: SpanTypeAttribute.LLM,
      provider: "openai",
    },
    event: {
      input,
      metadata: filterFrom(params, ["input", "instructions"]),
    },
    startTime: getCurrentUnixTimestamp(),
  };
  return {
    span: startSpan(spanArgs),
    start: spanArgs.startTime,
  };
}

// convert response.create result into an event
function parseEventFromResponseCreateResult(result: any) {
  return {
    output: result?.output_text || "",
    metrics: parseMetricsFromUsage(result?.usage),
  };
}

function traceResponseCreateStream(
  stream: AsyncIterator<any>,
  timedSpan: TimedSpan,
) {
  const span = timedSpan.span;
  let ttft = -1;
  return async function <T>(...args: [any]): Promise<IteratorResult<T>> {
    const result = await stream.next(...args);

    if (ttft === -1) {
      ttft = getCurrentUnixTimestamp() - timedSpan.start;
      span.log({ metrics: { time_to_first_token: ttft } });
    }

    if (result.done) {
      span.end();
      return result;
    }

    const item = result.value;
    if (!item || !item?.type || !item?.response) {
      return result; // unexpected
    }

    const event = parseLogFromItem(item);
    span.log(event);

    return result;
  };
}

function parseLogFromItem(item: any): {} {
  if (!item || !item?.type || !item?.response) {
    return {};
  }

  const response = item.response;

  switch (item.type) {
    case "response.completed":
      // I think there is usually only one output, but since they are arrays
      // we'll collect them all just in case.
      const texts = [];
      for (const output of response?.output || []) {
        for (const content of output?.content || []) {
          if (content?.type === "output_text") {
            texts.push(content.text);
          }
        }
      }
      return {
        output: texts.join(""),
        metrics: parseMetricsFromUsage(response?.usage),
      };
    default:
      return {};
  }
}

function responsesStreamProxy(target: any): (params: any) => Promise<any> {
  return new Proxy(target, {
    apply(target, thisArg, argArray) {
      const responseStream: any = Reflect.apply(target, thisArg, argArray);
      if (!argArray || argArray.length === 0) {
        return responseStream;
      }

      const timedSpan = parseSpanFromResponseCreateParams(argArray[0]);
      const span = timedSpan.span;

      let ttft = -1;

      responseStream.on("event", (event: any) => {
        if (ttft === -1) {
          ttft = getCurrentUnixTimestamp() - timedSpan.start;
          span.log({ metrics: { time_to_first_token: ttft } });
        }
        const logEvent = parseLogFromItem(event);
        span.log(logEvent);
      });

      responseStream.on("end", () => {
        span.end();
      });

      return responseStream;
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
  span.log({
    output: response.choices,
    metrics: {
      time_to_first_token: getCurrentUnixTimestamp() - startTime,
      tokens: response.usage?.total_tokens,
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
    },
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
  let ret: StartSpanArgs = {
    ...spanInfoRest,
    event: {
      metadata: spanInfoMetadata,
    },
  };
  const input = params[inputField];
  const paramsRest = { ...params };
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
    metrics: {
      tokens: result.usage?.total_tokens,
      prompt_tokens: result.usage?.prompt_tokens,
    },
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

type StartedSpan = {
  span: Span;
  startTime: number;
};

function parseMetricsFromUsage(usage: any): Record<string, number> {
  if (!usage) {
    return {};
  }

  // example : {
  //   input_tokens: 14,
  //   input_tokens_details: { cached_tokens: 0 },
  //   output_tokens: 8,
  //   output_tokens_details: { reasoning_tokens: 0 },
  //   total_tokens: 22
  // }

  const keys = [
    ["input_tokens", "prompt_tokens"],
    ["output_tokens", "completion_tokens"],
    ["total_tokens", "tokens"],
  ];

  const metrics: Record<string, number> = {};
  for (const [src, target] of keys) {
    const value = usage[src];
    if (value !== undefined && value !== null) {
      metrics[target] = value;
    }
  }

  const details: string[] = ["input", "output"];
  for (const src of details) {
    const details = usage[`${src}_tokens_details`];
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        const metricName = `${src}_${key}` as string;
        if (typeof value === "number") {
          metrics[metricName] = value;
        }
      }
    }
  }

  return metrics;
}
