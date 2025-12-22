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

console.log(
  "Running @langchain/core version:",
  require("@langchain/core/package.json").version,
);

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

const logger = initLogger({
  projectName: "golden-ts-langchain-v0",
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
        const result = (await chain.invoke({
          country: "France",
        })) as BaseMessage;
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await chain.invoke({
          input: "Tell me about the weather.",
        })) as BaseMessage;
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

        const stream = await chain.stream({});
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await model.invoke(messages)) as BaseMessage;
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
        const result = (await chain.invoke({})) as AIMessage;
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
        const result = (await modelWithTools.invoke(query)) as AIMessage;

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
          const secondResult = (await modelWithTools.invoke(
            messages,
          )) as AIMessage;
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
        const result = (await chain.invoke({ topic })) as BaseMessage;
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

        const stream = await chain.stream({ category });
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

// Test 18: Reasoning with extended thinking
async function testReasoning() {
  return traced(
    async () => {
      console.log("\n=== Test 18: Reasoning with Extended Thinking ===");

      // Anthropic supports extended thinking
      const model = new ChatAnthropic({
        model: "claude-sonnet-4-20250514",
        maxTokens: 200,
        callbacks: [handler],
        thinkingConfig: {
          type: "enabled",
          budgetTokens: 5000,
        },
      });

      const prompt = ChatPromptTemplate.fromTemplate(
        "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
      );
      const chain = prompt.pipe(model);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const result = (await chain.invoke({})) as BaseMessage;
      console.log(result.content);
      console.log();
    },
    { name: "test_reasoning" },
  );
}

// Test 19: Error handling
async function testErrorHandling() {
  return traced(
    async () => {
      console.log("\n=== Test 19: Error Handling ===");

      // Test 1: Invalid model name
      await traced(
        async () => {
          console.log("\n--- Test 1: Invalid Model Name ---");
          try {
            const model = new ChatOpenAI({
              model: "gpt-nonexistent-model",
              maxTokens: 100,
              callbacks: [handler],
            });
            await model.invoke("Hello");
            throw new Error("Should have thrown an error");
          } catch (error) {
            console.log("Caught invalid model error:");
            console.log(
              `  Message: ${error instanceof Error ? error.message : error}`,
            );
          }
        },
        { name: "test_error_invalid_model" },
      );

      // Test 2: Malformed tool arguments
      await traced(
        async () => {
          console.log("\n--- Test 2: Malformed Tool Result ---");
          try {
            const model = new ChatOpenAI({
              model: "gpt-4o",
              maxTokens: 100,
              callbacks: [handler],
            });

            const messages = [
              new HumanMessage("Calculate 5 + 3"),
              new AIMessage({
                content: "",
                tool_calls: [
                  {
                    id: "call_abc123",
                    name: "calculate",
                    args: { a: 5, b: 3, operation: "add" },
                  },
                ],
              }),
              new ToolMessage({
                content: "8",
                tool_call_id: "call_wrong_id", // Mismatched ID
              }),
            ];

            await model.invoke(messages);
            throw new Error("Should have thrown an error");
          } catch (error) {
            console.log("Caught tool call ID mismatch error:");
            console.log(
              `  Message: ${error instanceof Error ? error.message : error}`,
            );
          }
        },
        { name: "test_error_malformed_tool" },
      );

      // Test 3: Invalid image URL
      await traced(
        async () => {
          console.log("\n--- Test 3: Invalid Image URL ---");
          try {
            const model = new ChatOpenAI({
              model: "gpt-4o",
              maxTokens: 100,
              callbacks: [handler],
            });

            const messages = [
              new HumanMessage({
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url: "https://example.com/nonexistent-image-404.jpg",
                    },
                  },
                  { type: "text", text: "What's in this image?" },
                ],
              }),
            ];

            await model.invoke(messages);
            throw new Error("Should have thrown an error");
          } catch (error) {
            console.log("Caught invalid image URL error:");
            console.log(
              `  Message: ${error instanceof Error ? error.message : error}`,
            );
          }
        },
        { name: "test_error_invalid_image_url" },
      );

      console.log("\nError handling tests completed");
    },
    { name: "test_error_handling" },
  );
}

// Test 20: Multi-round tool use
async function testMultiRoundToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 20: Multi-Round Tool Use ===");

      const getStorePriceTool = new DynamicStructuredTool({
        name: "get_store_price",
        description: "Get the price of an item from a specific store",
        schema: z.object({
          store: z
            .string()
            .describe("The store name (e.g., 'StoreA', 'StoreB')"),
          item: z.string().describe("The item to get the price for"),
        }),
        func: async ({ store, item }) => {
          const prices: Record<string, Record<string, number>> = {
            StoreA: { laptop: 999, mouse: 25, keyboard: 75 },
            StoreB: { laptop: 1099, mouse: 20, keyboard: 80 },
          };
          const price = prices[store]?.[item] ?? 0;
          return JSON.stringify({
            store,
            item,
            price,
          });
        },
      });

      const applyDiscountTool = new DynamicStructuredTool({
        name: "apply_discount",
        description: "Apply a discount code to a total amount",
        schema: z.object({
          total: z.number().describe("The total amount before discount"),
          discountCode: z.string().describe("The discount code to apply"),
        }),
        func: async ({ total, discountCode }) => {
          const discounts: Record<string, number> = {
            SAVE10: 0.1,
            SAVE20: 0.2,
            HALF: 0.5,
          };
          const discountRate = discounts[discountCode] ?? 0;
          const discountAmount = total * discountRate;
          const finalTotal = total - discountAmount;
          return JSON.stringify({
            originalTotal: total,
            discountCode,
            discountRate: `${discountRate * 100}%`,
            discountAmount,
            finalTotal,
          });
        },
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const modelWithTools = model.bindTools([
          getStorePriceTool,
          applyDiscountTool,
        ]);

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const result = (await modelWithTools.invoke(
          "I want to buy a laptop. Get the price from StoreA and StoreB, then apply the discount code SAVE20 to whichever is cheaper.",
        )) as AIMessage;

        console.log("Response:");
        if (result.content) {
          console.log(`Text: ${result.content}`);
        }

        if (result.tool_calls && result.tool_calls.length > 0) {
          console.log(`Tool calls made: ${result.tool_calls.length}`);
          result.tool_calls.forEach((call, i) => {
            console.log(`  Tool call ${i + 1}: ${call.name}`);
            console.log(`    Args: ${JSON.stringify(call.args)}`);
          });
        }
        console.log();
      }
    },
    { name: "test_multi_round_tool_use" },
  );
}

// Test 21: Structured output
async function testStructuredOutput() {
  return traced(
    async () => {
      console.log("\n=== Test 21: Structured Output ===");

      const recipeSchema = z.object({
        name: z.string(),
        ingredients: z.array(
          z.object({
            name: z.string(),
            amount: z.string(),
          }),
        ),
        steps: z.array(z.string()),
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const structuredModel = model.withStructuredOutput(recipeSchema);
        const result = await structuredModel.invoke(
          "Generate a simple recipe for chocolate chip cookies.",
        );

        console.log("Parsed recipe:");
        console.log(`Name: ${result.name}`);
        console.log(`Ingredients: ${result.ingredients.length}`);
        console.log(`Steps: ${result.steps.length}`);
        console.log();
      }
    },
    { name: "test_structured_output" },
  );
}

// Test 22: Streaming structured output
async function testStreamingStructuredOutput() {
  return traced(
    async () => {
      console.log("\n=== Test 22: Streaming Structured Output ===");

      const productSchema = z.object({
        name: z.string(),
        description: z.string(),
        price: z.number(),
        features: z.array(z.string()),
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const structuredModel = model.withStructuredOutput(productSchema);
        const stream = await structuredModel.stream(
          "Generate a product description for a wireless bluetooth headphone.",
        );

        let finalResult;
        for await (const chunk of stream) {
          finalResult = chunk;
        }

        console.log("Final structured output:");
        console.log(`Name: ${finalResult?.name}`);
        console.log(`Price: ${finalResult?.price}`);
        console.log();
      }
    },
    { name: "test_streaming_structured_output" },
  );
}

// Test 23: Structured output with context (after tool calls)
async function testStructuredOutputWithContext() {
  return traced(
    async () => {
      console.log("\n=== Test 23: Structured Output with Context ===");

      const comparisonSchema = z.object({
        recommendation: z.enum(["phone-123", "laptop-456", "neither"]),
        reasoning: z.string(),
        priceComparison: z.object({
          cheaper: z.string(),
          priceDifference: z.number(),
        }),
        overallRating: z.object({
          phone: z.number(),
          laptop: z.number(),
        }),
      });

      for (const [provider, model] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
        ],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        // Simulate data that would be gathered via tools
        const productInfo = {
          "phone-123": {
            name: "SuperPhone X",
            price: 999,
            specs: "6.5 inch display, 128GB storage, 12MP camera",
          },
          "laptop-456": {
            name: "ProBook Ultra",
            price: 1499,
            specs: "15 inch display, 512GB SSD, 16GB RAM",
          },
        };

        const reviews = {
          "phone-123": {
            rating: 4.5,
            comments: [
              "Great camera!",
              "Battery lasts all day",
              "A bit pricey",
            ],
          },
          "laptop-456": {
            rating: 4.2,
            comments: ["Fast performance", "Good display", "Heavy to carry"],
          },
        };

        const structuredModel = model.withStructuredOutput(comparisonSchema);
        const result = await structuredModel.invoke(
          `Compare phone-123 and laptop-456. Here is the product info and reviews:

Product Info:
- phone-123: ${JSON.stringify(productInfo["phone-123"])}
- laptop-456: ${JSON.stringify(productInfo["laptop-456"])}

Reviews:
- phone-123: ${JSON.stringify(reviews["phone-123"])}
- laptop-456: ${JSON.stringify(reviews["laptop-456"])}

Give me a structured comparison with your recommendation.`,
        );

        console.log("Product comparison:");
        console.log(`Recommendation: ${result.recommendation}`);
        console.log(`Reasoning: ${result.reasoning.substring(0, 100)}...`);
        console.log(`Cheaper: ${result.priceComparison.cheaper}`);
        console.log(
          `Price difference: $${result.priceComparison.priceDifference}`,
        );
        console.log();
      }
    },
    { name: "test_structured_output_with_context" },
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
    testErrorHandling,
    testMultiRoundToolUse,
    testStructuredOutput,
    testStreamingStructuredOutput,
    testStructuredOutputWithContext,
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
