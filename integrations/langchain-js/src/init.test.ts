import { CallbackManager } from "@langchain/core/callbacks/manager";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { flush } from "braintrust";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { BraintrustCallbackHandler } from "./BraintrustCallbackHandler";
import { CHAT_MATH } from "./BraintrustCallbackHandler.fixtures";
import { init } from "./init";
import { server } from "./test/setup";
import { LogsRequest } from "./test/types";
import { logsToSpans, withLogging } from "./test/utils";

const handler = withLogging(new BraintrustCallbackHandler({ debug: true }));

describe("init", () => {
  it("should register the BraintrustCallbackHandler", async () => {
    init({ handler });

    const manager = CallbackManager.configure();
    expect(
      manager?.handlers.filter(
        (handler) => handler instanceof BraintrustCallbackHandler,
      )[0],
    ).toBe(handler);

    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(CHAT_MATH);
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["4bc6305f-2175-4481-bc84-7c55a456b7ea"]);
      }),
    );

    const prompt = ChatPromptTemplate.fromTemplate(`What is 1 + {number}?`);
    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    const chain = prompt.pipe(model);

    const message = await chain.invoke({ number: "2" });

    await flush();

    const { spans, root_span_id } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        span_attributes: {
          name: "RunnableSequence",
          type: "task",
        },
        input: {
          number: "2",
        },
        metadata: {
          tags: [],
        },
        span_id: root_span_id,
        root_span_id,
      },
      {
        span_attributes: { name: "ChatPromptTemplate" },
        input: { number: "2" },
        output: "What is 1 + 2?",
        metadata: { tags: ["seq:step:1"] },
        root_span_id,
        span_parents: [root_span_id],
      },
      {
        span_attributes: { name: "ChatOpenAI", type: "llm" },
        input: [
          {
            content: "What is 1 + 2?",
            role: "user",
          },
        ],
        output: [
          {
            content: "1 + 2 equals 3.",
            role: "assistant",
          },
        ],
        metadata: {
          tags: ["seq:step:2"],
          model: "gpt-4o-mini",
          temperature: 1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          n: 1,
        },
        root_span_id,
        span_parents: [root_span_id],
      },
    ]);

    expect(message.content).toBe("1 + 2 equals 3.");
  });
});
