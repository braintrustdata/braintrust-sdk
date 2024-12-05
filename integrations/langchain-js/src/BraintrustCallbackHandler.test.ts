import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { RunnableMap } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { flush, initLogger } from "braintrust";
import { http, HttpResponse } from "msw";
import { ReadableStream } from "stream/web";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BraintrustCallbackHandler } from "./BraintrustCallbackHandler";
import { server } from "./test/setup";
import { LogsRequest } from "./test/types";
import { logsToSpans } from "./test/utils";

initLogger({
  projectName: "langchain",
});

const handler = new BraintrustCallbackHandler();
const encoder = new TextEncoder();

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

  it("should handle streaming LLM calls", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", async () => {
        const stream = new ReadableStream({
          start(controller) {
            const chunks = [
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"role":"assistant","content":"","refusal":null},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":"Pol"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":"ly"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":" wants"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":" more"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":" crackers"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{"content":"!"},"logprobs":null,"finish_reason":null}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}],"usage":null}`,
              `data: {"id":"chatcmpl-Ab9p7esnOlnH4ywBeHQOp4ScoCcde","object":"chat.completion.chunk","created":1733419261,"model":"gpt-4o-mini-2024-07-18","system_fingerprint":"fp_0705bf87c0","choices":[],"usage":{"prompt_tokens":16,"completion_tokens":6,"total_tokens":22,"prompt_tokens_details":{"cached_tokens":0,"audio_tokens":0},"completion_tokens_details":{"reasoning_tokens":0,"audio_tokens":0,"accepted_prediction_tokens":0,"rejected_prediction_tokens":0}}}`,
              `data: [DONE]`,
            ];

            for (const chunk of chunks) {
              controller.enqueue(encoder.encode(chunk + "\n\n"));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Transfer-Encoding": "chunked",
          },
        });
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["stream-span-id"]);
      }),
    );

    const prompt = ChatPromptTemplate.fromTemplate(
      `tell me a four word joke about {topic}`,
    );
    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
      streaming: true,
    });

    const chain = prompt.pipe(model);

    const stream = await chain.stream(
      { topic: "parrot" },
      { callbacks: [handler] },
    );

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    await flush();

    const { spans, root_span_id } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        span_attributes: {
          name: "RunnableSequence",
          type: "task",
        },
        input: {
          topic: "parrot",
        },
        metadata: {
          tags: [],
        },
        span_id: root_span_id,
        root_span_id,
      },
      {
        span_attributes: { name: "ChatPromptTemplate" },
        input: { topic: "parrot" },
        output: "tell me a four word joke about parrot",
        metadata: { tags: ["seq:step:1"] },
        root_span_id,
        span_parents: [root_span_id],
      },
      {
        span_attributes: { name: "ChatOpenAI", type: "llm" },
        input: [
          {
            content: "tell me a four word joke about parrot",
            role: "user",
          },
        ],
        output: [
          {
            content: "Polly wants more crackers!",
            role: "assistant",
          },
        ],
        metadata: {
          tags: ["seq:step:2"],
          model: "gpt-4o-mini",
        },
        root_span_id,
        span_parents: [root_span_id],
      },
    ]);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should handle multi-step chains with memory", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          id: "chatcmpl-AbAHIqtiUXMz849pZPWxB7RKF9wPh",
          object: "chat.completion",
          created: 1733421008,
          model: "gpt-4o-mini-2024-07-18",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  "Assistant: I'm called Assistant! How can I help you today?",
                refusal: null,
              },
              logprobs: null,
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 24,
            completion_tokens: 13,
            total_tokens: 37,
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
        return HttpResponse.json(["memory-span-id"]);
      }),
    );

    const prompt = ChatPromptTemplate.fromTemplate(`{history} User: {input}`);
    const model = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    const chain = prompt.pipe(model);

    const memory = { history: "Assistant: Hello! How can I assist you today?" };
    await chain.invoke(
      { input: "What's your name?", ...memory },
      { callbacks: [handler] },
    );

    await flush();

    const { spans, root_span_id } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        span_attributes: {
          name: "RunnableSequence",
          type: "task",
        },
        input: {
          input: "What's your name?",
          history: "Assistant: Hello! How can I assist you today?",
        },
        metadata: {
          tags: [],
        },
        span_id: root_span_id,
        root_span_id,
      },
      {
        span_attributes: { name: "ChatPromptTemplate" },
        input: {
          input: "What's your name?",
          history: "Assistant: Hello! How can I assist you today?",
        },
        output:
          "Assistant: Hello! How can I assist you today? User: What's your name?",
        metadata: { tags: ["seq:step:1"] },
        root_span_id,
        span_parents: [root_span_id],
      },
      {
        span_attributes: { name: "ChatOpenAI", type: "llm" },
        input: [
          {
            content:
              "Assistant: Hello! How can I assist you today? User: What's your name?",
            role: "user",
          },
        ],
        output: [
          {
            content:
              "Assistant: I'm called Assistant! How can I help you today?",
            role: "assistant",
          },
        ],
        metadata: {
          tags: ["seq:step:2"],
          model: "gpt-4o-mini",
        },
        root_span_id,
        span_parents: [root_span_id],
      },
    ]);
  });

  it("should handle tool/agent usage", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", async () => {
        return HttpResponse.json({
          id: "chatcmpl-AbAVR1TojvbDgXRLlDyhz9NYZVitz",
          object: "chat.completion",
          created: 1733421885,
          model: "gpt-4o-mini-2024-07-18",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_G2Qd8HzTMyFUiMafz5H4fBIi",
                    type: "function",
                    function: {
                      name: "calculator",
                      arguments:
                        '{"operation":"multiply","number1":3,"number2":12}',
                    },
                  },
                ],
                refusal: null,
              },
              logprobs: null,
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 93,
            completion_tokens: 24,
            total_tokens: 117,
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
        return HttpResponse.json(["tool-span-id"]);
      }),
    );

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
    });

    const calculatorSchema = z.object({
      operation: z
        .enum(["add", "subtract", "multiply", "divide"])
        .describe("The type of operation to execute."),
      number1: z.number().describe("The first number to operate on."),
      number2: z.number().describe("The second number to operate on."),
    });

    const calculatorTool = tool(
      ({ operation, number1, number2 }) => {
        // Functions must return strings
        if (operation === "add") {
          return `${number1 + number2}`;
        } else if (operation === "subtract") {
          return `${number1 - number2}`;
        } else if (operation === "multiply") {
          return `${number1 * number2}`;
        } else if (operation === "divide") {
          return `${number1 / number2}`;
        } else {
          throw new Error("Invalid operation.");
        }
      },
      {
        name: "calculator",
        description: "Can perform mathematical operations.",
        schema: calculatorSchema,
      },
    );

    const llmWithTools = llm.bindTools([calculatorTool]);

    await llmWithTools.invoke("What is 3 * 12", {
      callbacks: [handler],
    });

    await flush();

    const { spans, root_span_id } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        span_id: root_span_id,
        root_span_id,
        span_attributes: {
          name: "ChatOpenAI",
          type: "llm",
        },
        input: [
          {
            content: "What is 3 * 12",
            role: "user",
          },
        ],
        metadata: {
          tags: [],
          model: "gpt-4o-mini",
          temperature: 1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          n: 1,
          tools: [
            {
              type: "function",
              function: {
                description: "Can perform mathematical operations.",
                name: "calculator",
                parameters: zodToJsonSchema(calculatorSchema),
              },
            },
          ],
        },
        output: [
          {
            content: "",
            role: "assistant",
            tool_calls: [
              {
                name: "calculator",
                args: {
                  operation: "multiply",
                  number1: 3,
                  number2: 12,
                },
                type: "tool_call",
                id: "call_G2Qd8HzTMyFUiMafz5H4fBIi",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("should handle parallel runnable execution", async () => {
    const logs: LogsRequest[] = [];

    const calls = [
      HttpResponse.json({
        id: "chatcmpl-AbCj2kznx4QsGpaocNir4GWdLYYqj",
        object: "chat.completion",
        created: 1733430416,
        model: "gpt-4o-mini-2024-07-18",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                'Why did the bear sit on the log?\n\nBecause it wanted to be a "bear-ly" seated customer! 🐻',
              refusal: null,
            },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 26,
          total_tokens: 39,
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
        system_fingerprint: "fp_bba3c8e70b",
      }),
      HttpResponse.json({
        id: "chatcmpl-AbClwtnbeqLRiWwoe21On10TRqqsW",
        object: "chat.completion",
        created: 1733430596,
        model: "gpt-4o-mini-2024-07-18",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                "In the forest's hush, a shadow moves near,  \nA gentle giant roams, the wise old bear.",
              refusal: null,
            },
            logprobs: null,
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 23,
          total_tokens: 38,
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
        system_fingerprint: "fp_bba3c8e70b",
      }),
    ];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return (
          calls.shift() || HttpResponse.json({ ok: false }, { status: 500 })
        );
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["parallel-span-id"]);
      }),
    );

    const model = new ChatOpenAI({ model: "gpt-4o-mini" });

    const jokeChain = PromptTemplate.fromTemplate(
      "Tell me a joke about {topic}",
    ).pipe(model);
    const poemChain = PromptTemplate.fromTemplate(
      "write a 2-line poem about {topic}",
    ).pipe(model);

    const mapChain = RunnableMap.from({
      joke: jokeChain,
      poem: poemChain,
    });

    await mapChain.invoke({ topic: "bear" }, { callbacks: [handler] });

    await flush();

    const { spans, root_span_id, root_run_id } = logsToSpans(logs);

    // verify that spans are in the correct order
    expect(spans).toMatchObject([
      {
        span_attributes: {
          name: "RunnableMap",
        },
      },
      {
        span_attributes: {
          name: "RunnableSequence",
        },
        metadata: {
          tags: ["map:key:joke"],
        },
      },
      {
        span_attributes: {
          name: "RunnableSequence",
        },
        metadata: {
          tags: ["map:key:poem"],
        },
      },
      {
        span_attributes: {
          name: "PromptTemplate",
        },
        metadata: {
          tags: ["seq:step:1"],
        },
      },
      {
        span_attributes: {
          name: "PromptTemplate",
        },
        metadata: {
          tags: ["seq:step:1"],
        },
      },
      {
        span_attributes: {
          name: "ChatOpenAI",
          type: "llm",
        },
        input: [
          {
            content: "Tell me a joke about bear",
            role: "user",
          },
        ],
        metadata: {
          tags: ["seq:step:2"],
        },
      },
      {
        span_attributes: {
          name: "ChatOpenAI",
          type: "llm",
        },
        input: [
          {
            content: "write a 2-line poem about bear",
            role: "user",
          },
        ],
        metadata: {
          tags: ["seq:step:2"],
        },
      },
    ]);

    const joke = {
      span_id: spans[1].span_id,
      run_id: spans[1].metadata?.runId,
    };

    const poem = {
      span_id: spans[2].span_id,
      run_id: spans[2].metadata?.runId,
    };

    // actual check for input/output, parent/child relationship, and metadata formatting
    expect(spans).toMatchObject([
      {
        span_id: root_span_id,
        root_span_id,
        input: {
          // TODO: do we want to be opinionated here?
          input: {
            topic: "bear",
          },
        },
        metadata: {
          runId: root_run_id,
        },
        output: {
          joke: 'Why did the bear sit on the log?\n\nBecause it wanted to be a "bear-ly" seated customer! 🐻',
          poem: "In the forest's hush, a shadow moves near,  \nA gentle giant roams, the wise old bear.",
        },
      },
      {
        span_parents: [root_span_id],
        input: {
          topic: "bear",
        },
        output:
          'Why did the bear sit on the log?\n\nBecause it wanted to be a "bear-ly" seated customer! 🐻',
        metadata: {
          parentRunId: root_run_id,
        },
      },
      {
        span_parents: [root_span_id],
        input: {
          topic: "bear",
        },
        output:
          "In the forest's hush, a shadow moves near,  \nA gentle giant roams, the wise old bear.",
        metadata: {
          parentRunId: root_run_id,
        },
      },
      {
        input: {
          topic: "bear",
        },
        output: "Tell me a joke about bear",
        metadata: {
          parentRunId: joke.run_id,
        },
        span_parents: [joke.span_id],
      },
      {
        input: {
          topic: "bear",
        },
        metadata: {
          parentRunId: poem.run_id,
        },
        output: "write a 2-line poem about bear",
        span_parents: [poem.span_id],
      },
      {
        span_parents: [joke.span_id],
        input: [
          {
            content: "Tell me a joke about bear",
            role: "user",
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
          parentRunId: joke.run_id,
        },
        output: [
          {
            content:
              'Why did the bear sit on the log?\n\nBecause it wanted to be a "bear-ly" seated customer! 🐻',
            role: "assistant",
          },
        ],
      },
      {
        span_parents: [poem.span_id],
        input: [
          {
            content: "write a 2-line poem about bear",
            role: "user",
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
          parentRunId: poem.run_id,
        },
        output: [
          {
            content:
              "In the forest's hush, a shadow moves near,  \nA gentle giant roams, the wise old bear.",
            role: "assistant",
          },
        ],
      },
    ]);
  });
});
