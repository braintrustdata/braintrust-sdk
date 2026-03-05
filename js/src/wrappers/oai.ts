/* eslint-disable @typescript-eslint/no-explicit-any */
import { CompiledPrompt } from "../logger";
import {
  LEGACY_CACHED_HEADER,
  parseCachedHeader,
  X_CACHED_HEADER,
} from "../openai-utils";
import { responsesProxy } from "./oai_responses";
import { OPENAI_CHANNEL } from "../instrumentation/plugins/channels";
import iso from "../isomorph";
import {
  APIPromise,
  ChannelContext,
  createLazyAPIPromise,
  EnhancedResponse,
  tracePromiseWithResponse,
} from "./openai-promise-utils";

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
 * not configured, nothing will be traced. If this is not an `OpenAI` object, this function is
 * a no-op.
 *
 * Currently, this supports both the `v4` and `v5` API.
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
  const completionProxy = new Proxy(openai.chat.completions, {
    get(target, name, receiver) {
      const baseVal = Reflect.get(target, name, receiver);
      if (name === "create") {
        return wrapChatCompletion(baseVal.bind(target));
      } else if (name === "parse") {
        return wrapBetaChatCompletionParse(baseVal.bind(target));
      } else if (name === "stream") {
        return wrapBetaChatCompletionStream(baseVal.bind(target));
      }
      return baseVal;
    },
  });

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

function wrapBetaChatCompletionParse<
  P extends ChatParams,
  C extends Promise<NonStreamingChatResponse>,
>(completion: (params: P) => C): (params: P) => Promise<any> {
  return async (allParams: P & SpanInfo) => {
    const { span_info, ...params } = allParams;
    const channel = iso.newTracingChannel(
      OPENAI_CHANNEL.BETA_CHAT_COMPLETIONS_PARSE,
    );
    return channel.tracePromise(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      async () => await completion(params as P),
      { arguments: [params], span_info },
    );
  };
}

function wrapBetaChatCompletionStream<
  P extends ChatParams,
  C extends StreamingChatResponse,
>(completion: (params: P) => C): (params: P & SpanInfo) => C {
  return (allParams: P & SpanInfo) => {
    const { span_info, ...params } = allParams;
    const channel = iso.newTracingChannel(
      OPENAI_CHANNEL.BETA_CHAT_COMPLETIONS_STREAM,
    );
    return channel.traceSync(
      () =>
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        completion(params as P),
      { arguments: [params], span_info },
    );
  };
}

// TODO: Mock this up better
type StreamingChatResponse = any;
export { LEGACY_CACHED_HEADER, parseCachedHeader, X_CACHED_HEADER };

function wrapChatCompletion<
  P extends ChatParams,
  C extends NonStreamingChatResponse | StreamingChatResponse,
>(
  completion: (params: P, options?: unknown) => APIPromise<C>,
): (params: P, options?: unknown) => APIPromise<C> {
  return (
    { span_info, ...params }: P & SpanInfo,
    options?: unknown,
  ): APIPromise<C> => {
    // Lazy execution - we must defer the API call until the promise is actually consumed
    // to avoid unhandled rejections when the underlying OpenAI call fails immediately.
    // Without lazy execution, the promise chain starts before error handlers are attached.
    let executionPromise: Promise<EnhancedResponse<C>> | null = null;

    const ensureExecuted = (): Promise<EnhancedResponse<C>> => {
      if (!executionPromise) {
        executionPromise = (async (): Promise<EnhancedResponse<C>> => {
          const traceContext: ChannelContext = {
            arguments: [params],
            span_info,
          };

          if (params.stream) {
            const completionPromise = completion(
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              params as P,
              options,
            ) as APIPromise<StreamingChatResponse>;
            const { data, response } = await tracePromiseWithResponse(
              OPENAI_CHANNEL.CHAT_COMPLETIONS_CREATE,
              traceContext,
              completionPromise,
            );
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            return { data: data as C, response };
          }

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const completionResponse = completion(
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            params as P,
            options,
          ) as APIPromise<NonStreamingChatResponse>;
          const { data, response } = await tracePromiseWithResponse(
            OPENAI_CHANNEL.CHAT_COMPLETIONS_CREATE,
            traceContext,
            completionResponse,
          );
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          return { data: data as C, response };
        })();
      }
      return executionPromise;
    };

    return createLazyAPIPromise(ensureExecuted);
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

type ModerationCreateParams = {
  input: string;
};

type CreateModerationResponse = {
  results: Array<any>;
  usage?: {
    cached?: number;
  };
};

function wrapApiCreateWithChannel<T, R>(
  create: (
    params: Omit<T & SpanInfo, "span_info">,
    options?: unknown,
  ) => APIPromise<R>,
  channelName: string,
): (params: T & SpanInfo, options?: unknown) => Promise<any> {
  return async (allParams: T & SpanInfo, options?: unknown) => {
    const { span_info, ...params } = allParams;
    const traceContext: ChannelContext = {
      arguments: [params],
      span_info,
    };
    const { data } = await tracePromiseWithResponse(
      channelName,
      traceContext,
      create(params, options),
    );
    return data;
  };
}

const wrapEmbeddings = (
  create: (
    params: EmbeddingCreateParams,
    options?: unknown,
  ) => APIPromise<CreateEmbeddingResponse>,
) =>
  wrapApiCreateWithChannel<EmbeddingCreateParams, CreateEmbeddingResponse>(
    create,
    OPENAI_CHANNEL.EMBEDDINGS_CREATE,
  );

const wrapModerations = (
  create: (
    params: ModerationCreateParams,
    options?: unknown,
  ) => APIPromise<CreateModerationResponse>,
) =>
  wrapApiCreateWithChannel<ModerationCreateParams, CreateModerationResponse>(
    create,
    OPENAI_CHANNEL.MODERATIONS_CREATE,
  );
