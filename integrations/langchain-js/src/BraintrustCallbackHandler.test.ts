import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { initLogger } from "braintrust";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { BraintrustCallbackHandler } from "./BraintrustCallbackHandler";
import { server } from "./test/setup";
import { LogsRequest } from "./test/types";
import { logsToSpans } from "./test/utils";

initLogger({
  projectName: "langchain",
});

const handler = new BraintrustCallbackHandler();

describe("BraintrustCallbackHandler", () => {
  it("should handle LLM calls", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          id: "chatcmpl-Aao716hWOt9HBihjWh9iAPGWRpkFd",
          object: "chat.completion",
          created: 1733335803,
          model: "gpt-4o-mini-2024-07-18",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "1 + 2 equals 3.",
                refusal: null,
              },
              logprobs: null,
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 8,
            total_tokens: 23,
            prompt_tokens_details: {
              cached_tokens: 0,
              audio_tokens: 0,
            },
            completion_tokens_details: {
              reasoning_tokens: 0,
              audio_tokens: 0,
              accepted_prediction_tokens: 0,
              rejected_prediction_tokens: 0,
            },
          },
          system_fingerprint: "fp_0705bf87c0",
        });
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

    const message = await chain.invoke(
      { number: "2" },
      { callbacks: [handler] },
    );

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
          params: {},
        },
        span_id: root_span_id,
        root_span_id,
      },
      {
        span_attributes: { name: "ChatPromptTemplate" },
        input: { number: "2" },
        output: {
          parsed: "What is 1 + 2?",
        },
        metadata: { tags: ["seq:step:1"], params: {} },
        root_span_id,
        span_parents: [root_span_id],
      },
      {
        span_attributes: { name: "ChatOpenAI" },
        input: [
          { content: "What is 1 + 2?", role: "user", additional_kwargs: {} },
        ],
        metadata: {
          tags: ["seq:step:2"],
          params: {
            model: "gpt-4o-mini",
            temperature: 1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            n: 1,
          },
        },
        root_span_id,
        span_parents: [root_span_id],
      },
    ]);

    expect(message.content).toBe("1 + 2 equals 3.");
  });
});
