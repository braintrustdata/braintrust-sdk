import { Span, startSpan } from "../logger";
import { getCurrentUnixTimestamp } from "../util";

interface BetaLike {
  chat: {
    completions: {
      stream: any;
    };
  };
}
interface ChatLike {
  completions: any;
}
interface OpenAILike {
  chat: ChatLike;
  beta?: BetaLike;
}

export function openAIV4NonProxyWrapper<T extends OpenAILike>(openai: T): T {
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
      if (name === "beta" && betaProxy) {
        return betaProxy;
      }
      return Reflect.get(target, name, receiver);
    },
  });

  return proxy;
}

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
>(completion: (params: P) => Promise<C>): (params: P) => Promise<any> {
  return async (params: P) => {
    const { messages, ...rest } = params;
    const span = startSpan({
      name: "OpenAI Chat Completion",
      event: {
        input: messages,
        metadata: {
          ...rest,
        },
      },
    });
    const startTime = getCurrentUnixTimestamp();

    const ret = (await completion(params)) as StreamingChatResponse;

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
>(completion: (params: P) => Promise<C>): (params: P) => Promise<any> {
  return async (params: P) => {
    const { messages, ...rest } = params;
    const span = startSpan({
      name: "OpenAI Chat Completion",
      event: {
        input: messages,
        metadata: {
          ...rest,
        },
      },
    });
    if (params.stream) {
      const startTime = getCurrentUnixTimestamp();
      const ret = (await completion(params)) as StreamingChatResponse;
      return new WrapperStream(span, startTime, ret);
    } else {
      try {
        const ret = (await completion(params)) as NonStreamingChatResponse;
        const { messages, ...rest } = params;
        span.log({
          input: messages,
          metadata: {
            ...rest,
          },
          output: ret.choices[0],
          metrics: {
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
        output: allResults,
      });
    } finally {
      this.span.end();
    }
  }
}
