import { traced, initLogger, log } from "braintrust";
import { BraintrustCallbackHandler } from "@braintrust/langchain-js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "fixtures");

const logger = initLogger({
  projectName: "golden-ts-langchain",
});

const handler = new BraintrustCallbackHandler({ logger });

// Test 1: Basic completion
async function testBasicCompletion() {
  return traced(
    async () => {
      console.log("\n=== Test 1: Basic Completion ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const prompt = ChatPromptTemplate.fromTemplate(
          "What is the capital of {country}?",
        );
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          {
            country: "France",
          },
          { callbacks: [handler] },
        )) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_basic_completion" },
  );
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
  return traced(
    async () => {
      console.log("\n=== Test 2: Multi-turn Conversation ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const messages = [
          new HumanMessage("Hi, my name is Alice."),
          new AIMessage("Hello Alice! Nice to meet you."),
          new HumanMessage("What did I just tell you my name was?"),
        ];
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_multi_turn" },
  );
}

// Test 3: System prompt
async function testSystemPrompt() {
  return traced(
    async () => {
      console.log("\n=== Test 3: System Prompt ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const systemMsg = "You are a pirate. Always respond in pirate speak.";
        const prompt = ChatPromptTemplate.fromMessages([
          ["system", systemMsg],
          ["human", "{input}"],
        ]);
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          {
            input: "Tell me about the weather.",
          },
          { callbacks: [handler] },
        )) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_system_prompt" },
  );
}

// Test 4: Streaming
async function testStreaming() {
  return traced(
    async () => {
      console.log("\n=== Test 4: Streaming ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const promptText = "Count from 1 to 10 slowly.";
        const prompt = ChatPromptTemplate.fromTemplate(promptText);
        const chain = prompt.pipe(model);

        const stream = await chain.stream({}, { callbacks: [handler] });
        for await (const chunk of stream) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const msg = chunk as BaseMessage;
          if (msg.content) {
            process.stdout.write(msg.content.toString());
          }
        }
        console.log("\n");
      }
    },
    { name: "test_streaming" },
  );
}

// Test 5: Image input
async function testImageInput() {
  return traced(
    async () => {
      console.log("\n=== Test 5: Image Input ===");
      const imageData = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        let messages;
        if (provider === "openai") {
          messages = [
            new HumanMessage({
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${imageData}` },
                },
                { type: "text", text: "What color is this image?" },
              ],
            }),
          ];
        } else {
          messages = [
            new HumanMessage({
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: imageData,
                  },
                },
                { type: "text", text: "What color is this image?" },
              ],
            }),
          ];
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_image_input" },
  );
}

// Test 6: Document input (PDF)
async function testDocumentInput() {
  return traced(
    async () => {
      console.log("\n=== Test 6: Document Input ===");
      const pdfData = readFileSync(
        `${FIXTURES_DIR}/test-document.pdf`,
        "base64",
      );

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        let messages;
        if (provider === "openai") {
          messages = [
            new HumanMessage({
              content: [
                {
                  type: "file",
                  file: {
                    file_data: `data:application/pdf;base64,${pdfData}`,
                    filename: "test-document.pdf",
                  },
                },
                { type: "text", text: "What is in this document?" },
              ],
            }),
          ];
        } else {
          messages = [
            new HumanMessage({
              content: [
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: pdfData,
                  },
                },
                { type: "text", text: "What is in this document?" },
              ],
            }),
          ];
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_document_input" },
  );
}

// Test 7: Temperature and top_p variations
async function testTemperatureVariations() {
  return traced(
    async () => {
      console.log("\n=== Test 7: Temperature Variations ===");

      const configs = [
        { temperature: 0.0, topP: 1.0 },
        { temperature: 1.0, topP: 0.9 },
        { temperature: 0.7, topP: 0.95 },
      ];

      for (const [provider, models] of [
        [
          "openai",
          configs.map(
            (config) =>
              new ChatOpenAI({
                model: "gpt-4o",
                maxTokens: 50,
                temperature: config.temperature,
                topP: config.topP,
              }),
          ),
        ],
        [
          "anthropic",
          configs.map(
            (config) =>
              new ChatAnthropic({
                model: "claude-sonnet-4-20250514",
                maxTokens: 50,
                temperature: config.temperature,
                topP: config.topP,
              }),
          ),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        for (let i = 0; i < configs.length; i++) {
          const config = configs[i];
          const model = models[i];
          console.log(
            `Config: temp=${config.temperature}, top_p=${config.topP}`,
          );
          const prompt = ChatPromptTemplate.fromTemplate(
            "Say something {topic}.",
          );
          const chain = prompt.pipe(model);
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const result = (await chain.invoke(
            {
              topic: "creative",
            },
            { callbacks: [handler] },
          )) as BaseMessage;
          console.log(result.content);
          console.log();
        }
      }
    },
    { name: "test_temperature_variations" },
  );
}

// Test 8: Stop sequences
async function testStopSequences() {
  return traced(
    async () => {
      console.log("\n=== Test 8: Stop Sequences ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            stop: ["END", "\n\n"],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            stopSequences: ["END"],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const topic = "robot";
        const prompt = ChatPromptTemplate.fromTemplate(
          `Write a short story about a ${topic}.`,
        );
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          {},
          { callbacks: [handler] },
        )) as AIMessage;
        console.log(result.content);
        console.log(
          `Response metadata: ${JSON.stringify(result.response_metadata)}`,
        );
        console.log();
      }
    },
    { name: "test_stop_sequences" },
  );
}

// Test 9: Metadata
async function testMetadata() {
  return traced(
    async () => {
      console.log("\n=== Test 9: Metadata ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            modelKwargs: { user: "test_user_123" },
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const messages = [new HumanMessage("Hello!")];
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_metadata" },
  );
}

// Test 10: Long context
async function testLongContext() {
  return traced(
    async () => {
      console.log("\n=== Test 10: Long Context ===");
      const longText = "The quick brown fox jumps over the lazy dog. ".repeat(
        100,
      );

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const prompt = ChatPromptTemplate.fromTemplate(
          "Here is a long text:\n\n{text}\n\nHow many times does the word 'fox' appear?",
        );
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          { text: longText },
          { callbacks: [handler] },
        )) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_long_context" },
  );
}

// Test 11: Mixed content types
async function testMixedContent() {
  return traced(
    async () => {
      console.log("\n=== Test 11: Mixed Content Types ===");
      const imageData = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        let messages;
        if (provider === "openai") {
          messages = [
            new HumanMessage({
              content: [
                { type: "text", text: "First, look at this image:" },
                {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${imageData}` },
                },
                {
                  type: "text",
                  text: "Now describe what you see and explain why it matters.",
                },
              ],
            }),
          ];
        } else {
          messages = [
            new HumanMessage({
              content: [
                { type: "text", text: "First, look at this image:" },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: imageData,
                  },
                },
                {
                  type: "text",
                  text: "Now describe what you see and explain why it matters.",
                },
              ],
            }),
          ];
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_mixed_content" },
  );
}

// Test 12: Prefill
async function testPrefill() {
  return traced(
    async () => {
      console.log("\n=== Test 12: Prefill ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const topic = "coding";
        const messages = [
          new HumanMessage(`Write a haiku about ${topic}.`),
          new AIMessage("Here is a haiku:"),
        ];
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await model.invoke(messages, {
          callbacks: [handler],
        })) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_prefill" },
  );
}

// Test 13: Very short max_tokens
async function testShortMaxTokens() {
  return traced(
    async () => {
      console.log("\n=== Test 13: Very Short Max Tokens ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 5,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 5,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const prompt = ChatPromptTemplate.fromTemplate("What is AI?");
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          {},
          { callbacks: [handler] },
        )) as AIMessage;
        console.log(result.content);
        console.log(
          `Response metadata: ${JSON.stringify(result.response_metadata)}`,
        );
        console.log();
      }
    },
    { name: "test_short_max_tokens" },
  );
}

// Test 14: Tool use
async function testToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 14: Tool Use ===");

      const getWeatherTool = new DynamicStructuredTool({
        name: "get_weather",
        description: "Get the current weather for a location",
        schema: z.object({
          city_and_state: z
            .string()
            .describe("The city and state, e.g. San Francisco, CA"),
          unit: z
            .enum(["celsius", "fahrenheit"])
            .optional()
            .default("celsius")
            .describe("The unit of temperature"),
        }),
        func: async ({ city_and_state, unit }) => {
          return `22 degrees ${unit} and sunny in ${city_and_state}`;
        },
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const modelWithTools = model.bindTools([getWeatherTool]);
        const query = "What is the weather like in Paris, France?";
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await modelWithTools.invoke(query, {
          callbacks: [handler],
        })) as AIMessage;

        console.log("Response content:");
        if (result.content) {
          console.log(`Text: ${result.content}`);
        }

        if (result.tool_calls && result.tool_calls.length > 0) {
          result.tool_calls.forEach((call, i) => {
            console.log(`Tool use block ${i}:`);
            console.log(`  Tool: ${call.name}`);
            console.log(`  Input: ${JSON.stringify(call.args)}`);
          });
        }
        console.log();
      }
    },
    { name: "test_tool_use" },
  );
}

// Test 15: Tool use with result
async function testToolUseWithResult() {
  return traced(
    async () => {
      console.log("\n=== Test 15: Tool Use With Result ===");

      const calculateTool = new DynamicStructuredTool({
        name: "calculate",
        description: "Perform a mathematical calculation",
        schema: z.object({
          operation: z
            .enum(["add", "subtract", "multiply", "divide"])
            .describe("The mathematical operation"),
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        }),
        func: async ({ operation, a, b }) => {
          switch (operation) {
            case "add":
              return (a + b).toString();
            case "subtract":
              return (a - b).toString();
            case "multiply":
              return (a * b).toString();
            case "divide":
              return b !== 0 ? (a / b).toString() : "0";
            default:
              return "0";
          }
        },
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const modelWithTools = model.bindTools([calculateTool]);
        const query = "What is 127 multiplied by 49?";

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const firstResult = (await modelWithTools.invoke(query)) as AIMessage;

        console.log("First response:");
        if (firstResult.tool_calls && firstResult.tool_calls.length > 0) {
          const toolCall = firstResult.tool_calls[0];
          console.log(`Tool called: ${toolCall.name}`);
          console.log(`Input: ${JSON.stringify(toolCall.args)}`);

          const result = 127 * 49;

          const messages = [
            new HumanMessage(query),
            new AIMessage({
              content: "",
              tool_calls: [toolCall],
            }),
            new ToolMessage({
              content: result.toString(),
              tool_call_id: toolCall.id!,
            }),
          ];

          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const secondResult = (await modelWithTools.invoke(messages, {
            callbacks: [handler],
          })) as AIMessage;
          console.log("\nSecond response (with tool result):");
          console.log(secondResult.content);
        }
        console.log();
      }
    },
    { name: "test_tool_use_with_result" },
  );
}

// Test 16: Async generation
async function testAsyncGeneration() {
  return traced(
    async () => {
      console.log("\n=== Test 16: Async Generation ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const topic = "programming";
        const prompt = ChatPromptTemplate.fromTemplate(
          "Tell me a joke about {topic}.",
        );
        const chain = prompt.pipe(model);
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await chain.invoke(
          { topic },
          { callbacks: [handler] },
        )) as BaseMessage;
        console.log(result.content);
        console.log();
      }
    },
    { name: "test_async_generation" },
  );
}

// Test 17: Async streaming
async function testAsyncStreaming() {
  return traced(
    async () => {
      console.log("\n=== Test 17: Async Streaming ===");

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const category = "programming languages";
        const prompt = ChatPromptTemplate.fromTemplate("List 3 {category}.");
        const chain = prompt.pipe(model);

        const stream = await chain.stream(
          { category },
          { callbacks: [handler] },
        );
        for await (const chunk of stream) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const msg = chunk as BaseMessage;
          if (msg.content) {
            process.stdout.write(msg.content.toString());
          }
        }
        console.log("\n");
      }
    },
    { name: "test_async_streaming" },
  );
}

// Test 18: Reasoning with o1 model
async function testReasoning() {
  return traced(
    async () => {
      log({
        output:
          "Responses API not supported and chat completions do not include (reasoning) summaries",
      });
    },
    { name: "test_reasoning" },
  );
}

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("LangChain Golden Tests with Braintrust");
  console.log("=".repeat(60));

  const tests = [
    testBasicCompletion,
    testMultiTurn,
    testSystemPrompt,
    testStreaming,
    testImageInput,
    testDocumentInput,
    testTemperatureVariations,
    testStopSequences,
    testMetadata,
    testLongContext,
    testMixedContent,
    testPrefill,
    testShortMaxTokens,
    testToolUse,
    testToolUseWithResult,
    testAsyncGeneration,
    testAsyncStreaming,
    testReasoning,
  ];

  for (const test of tests) {
    try {
      await test();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(
        `Test ${test.name} failed:`,
        error instanceof Error ? error.message : error,
      );
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
        process.exit(1);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

runAllTests().catch(console.error);
