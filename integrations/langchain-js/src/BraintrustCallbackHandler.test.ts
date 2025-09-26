import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { RunnableMap } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { END, START, StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { flush, initLogger, NOOP_SPAN } from "braintrust";
import { http, HttpResponse } from "msw";
import { ReadableStream } from "stream/web";
import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BraintrustCallbackHandler } from "./BraintrustCallbackHandler";
import {
  CHAT_BEAR_JOKE,
  CHAT_BEAR_POEM,
  CHAT_CHAIN_MEMORY,
  CHAT_MATH,
  CHAT_SAY_HELLO,
  CHAT_STREAM_PARROT,
  CHAT_TOOL_CALCULATOR,
} from "./BraintrustCallbackHandler.fixtures";
import { server } from "./test/setup";
import { LogsRequest } from "./test/types";
import { logsToSpans, withLogging } from "./test/utils";

initLogger({
  projectName: "langchain",
});

const handler = withLogging(new BraintrustCallbackHandler({ debug: true }));

const encoder = new TextEncoder();

describe("BraintrustCallbackHandler", () => {
  it("should handle LLM calls", async () => {
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
      model: "gpt-4o-mini-2024-07-18",
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
        span_attributes: { name: "ChatPromptTemplate", type: "task" },
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
          model: "gpt-4o-mini-2024-07-18",
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
            const chunks = CHAT_STREAM_PARROT;

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
      model: "gpt-4o-mini-2024-07-18",
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
        span_attributes: { name: "ChatPromptTemplate", type: "task" },
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
          model: "gpt-4o-mini-2024-07-18",
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
        return HttpResponse.json(CHAT_CHAIN_MEMORY);
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["memory-span-id"]);
      }),
    );

    const prompt = ChatPromptTemplate.fromTemplate(`{history} User: {input}`);
    const model = new ChatOpenAI({
      model: "gpt-4o-mini-2024-07-18",
    });

    const chain = prompt.pipe(model);

    const memory = { history: "Assistant: Hello! How can I assist you today?" };
    await chain.invoke(
      { input: "What's your name?", ...memory },
      { callbacks: [handler], tags: ["test"] },
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
          tags: ["test"],
        },
        span_id: root_span_id,
        root_span_id,
      },
      {
        span_attributes: { name: "ChatPromptTemplate", type: "task" },
        input: {
          input: "What's your name?",
          history: "Assistant: Hello! How can I assist you today?",
        },
        output:
          "Assistant: Hello! How can I assist you today? User: What's your name?",
        metadata: { tags: ["seq:step:1", "test"] },
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
          tags: ["seq:step:2", "test"],
          model: "gpt-4o-mini-2024-07-18",
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
        return HttpResponse.json(CHAT_TOOL_CALCULATOR);
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["tool-span-id"]);
      }),
    );

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini-2024-07-18",
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
          model: "gpt-4o-mini-2024-07-18",
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
      HttpResponse.json(CHAT_BEAR_JOKE),
      HttpResponse.json(CHAT_BEAR_POEM),
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

    const model = new ChatOpenAI({ model: "gpt-4o-mini-2024-07-18" });

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
          type: "task",
        },
      },
      {
        span_attributes: {
          name: "RunnableSequence",
          type: "task",
        },
        metadata: {
          tags: ["map:key:joke"],
        },
      },
      {
        span_attributes: {
          name: "RunnableSequence",
          type: "task",
        },
        metadata: {
          tags: ["map:key:poem"],
        },
      },
      {
        span_attributes: {
          name: "PromptTemplate",
          type: "task",
        },
        metadata: {
          tags: ["seq:step:1"],
        },
      },
      {
        span_attributes: {
          name: "PromptTemplate",
          type: "task",
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
          model: "gpt-4o-mini-2024-07-18",
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
          model: "gpt-4o-mini-2024-07-18",
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

  it("should handle LangGraph state management", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post("https://api.openai.com/v1/chat/completions", async () => {
        return HttpResponse.json(CHAT_SAY_HELLO);
      }),

      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["graph-span-id"]);
      }),
    );

    // derived from: https://techcommunity.microsoft.com/blog/educatordeveloperblog/an-absolute-beginners-guide-to-langgraph-js/4212496
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type HelloWorldGraphState = Record<string, any>;

    const graphStateChannels: StateGraphArgs<HelloWorldGraphState>["channels"] =
      {};

    const model = new ChatOpenAI({
      model: "gpt-4o-mini-2024-07-18",
      callbacks: [handler],
    });

    async function sayHello(state: HelloWorldGraphState) {
      const res = await model.invoke("Say hello");
      return res.content;
    }

    function sayBye(state: HelloWorldGraphState) {
      console.log(`From the 'sayBye' node: Bye world!`);
      return {};
    }

    const graphBuilder = new StateGraph({ channels: graphStateChannels }) // Add our nodes to the Graph
      .addNode("sayHello", sayHello)
      .addNode("sayBye", sayBye) // Add the edges between nodes
      .addEdge(START, "sayHello")
      .addEdge("sayHello", "sayBye")
      .addEdge("sayBye", END);

    const helloWorldGraph = graphBuilder.compile();

    await helloWorldGraph.invoke({}, { callbacks: [handler] });

    await flush();

    const { spans } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        span_attributes: {
          name: "LangGraph",
          type: "task",
        },
        input: {},
        metadata: {
          tags: [],
        },
        output: {},
      },
      {
        span_attributes: {
          name: "sayHello",
          type: "task",
        },
        input: {},
        metadata: {
          tags: ["graph:step:1"],
        },
        output: {
          output: "Hello! How can I assist you today?",
        },
      },
      {
        span_attributes: {
          name: "ChatOpenAI",
          type: "llm",
        },
        input: [
          {
            content: "Say hello",
            role: "user",
          },
        ],
        metadata: {
          model: "gpt-4o-mini-2024-07-18",
          temperature: 1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          n: 1,
          tags: [],
        },
        metrics: {
          completion_tokens: 9,
          end: expect.any(Number),
          prompt_tokens: 9,
          start: expect.any(Number),
          total_tokens: 18,
        },
        output: [
          {
            content: "Hello! How can I assist you today?",
            role: "assistant",
          },
        ],
      },
      {
        span_attributes: {
          name: "sayBye",
          type: "task",
        },
        input: {},
        metadata: {
          tags: ["graph:step:2"],
        },
        output: {},
      },
    ]);
  });

  it("should have correctly typed constructor parameters", async () => {
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

    const handler = new BraintrustCallbackHandler({
      logger: NOOP_SPAN,
    });

    handler.handleLLMStart(
      {
        name: "test",
        lc: 1,
        type: "secret",
        id: ["test"],
      },
      ["test"],
      "test",
      "test",
    );

    await flush();

    expect(logs).toEqual([]);
  });

  it("should handle chain inputs/outputs with null/undefined values", async () => {
    const logs: LogsRequest[] = [];

    server.use(
      http.post(/.+logs/, async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        logs.push((await request.json()) as LogsRequest);
        return HttpResponse.json(["null-span-id"]);
      }),
    );

    // Test chain with null/undefined inputs
    await handler.handleChainStart(
      { id: ["TestChain"], lc: 1, type: "not_implemented" },
      { input1: "value1", input2: null, input3: undefined },
      "run-1",
      undefined,
      ["test"],
    );

    await handler.handleChainEnd(
      { output1: "value1", output2: null, output3: undefined },
      "run-1",
      undefined,
      ["test"],
    );

    await flush();

    const { spans, root_span_id } = logsToSpans(logs);

    expect(spans).toMatchObject([
      {
        root_span_id,
        span_attributes: {
          name: "TestChain",
          type: "task",
        },
        input: {
          input1: "value1",
          input2: null,
        },
        metadata: {
          tags: ["test"],
          runId: "run-1",
        },
        output: {
          output1: "value1",
          output2: null,
        },
      },
    ]);
  });
});
