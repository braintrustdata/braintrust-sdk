import { Span, startSpan } from "../logger";
import { getCurrentUnixTimestamp } from "../util";

interface ChatLike {
  completions: any;
}
interface OpenAILike {
  chat: ChatLike;
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
  let proxy = new Proxy(openai, {
    get(target, name, receiver) {
      if (name === "chat") {
        return chatProxy;
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

// TODO: Mock this up better
type StreamingChatResponse = any;

function wrapChatCompletion<
  P extends ChatParams,
  C extends NonStreamingChatResponse | StreamingChatResponse
>(completion: (params: P) => Promise<C>): (params: P) => Promise<any> {
  return async (params: P) => {
    const { messages, ...rest } = params;
    const span = await startSpan({
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
