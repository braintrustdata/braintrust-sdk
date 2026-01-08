import { traced, initLogger } from "braintrust";
import { BraintrustCallbackHandler } from "@braintrust/langchain-js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createAgent } from "langchain";
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

const version = require("langchain/package.json").version;

console.log("Running @langchain/core version:", version);

if (version.startsWith("0.")) {
  console.error("LangChain v0 is not supported");
  process.exit(1);
}

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

const logger = initLogger({
  projectName: "golden-ts-langchain-v1.0",
});

const handler = new BraintrustCallbackHandler({ logger });

// Test 1: Basic completion
async function testBasicCompletion() {
  return traced(
    async () => {
      console.log("\n=== Test 1: Basic Completion ===");

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromTemplate(
              "What is the capital of {country}?",
            );
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({
              country: "France",
            });
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [
                  { role: "user", content: "What is the capital of France?" },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        await traced(
          async () => {
            const messages = [
              new HumanMessage("Hi, my name is Alice."),
              new AIMessage("Hello Alice! Nice to meet you."),
              new HumanMessage("What did I just tell you my name was?"),
            ];
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [
                  { role: "user", content: "Hi, my name is Alice." },
                  {
                    role: "assistant",
                    content: "Hello Alice! Nice to meet you.",
                  },
                  {
                    role: "user",
                    content: "What did I just tell you my name was?",
                  },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const systemMsg = "You are a pirate. Always respond in pirate speak.";

        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromMessages([
              ["system", systemMsg],
              ["human", "{input}"],
            ]);
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({
              input: "Tell me about the weather.",
            });
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              systemPrompt: systemMsg,
            });
            await agent.invoke(
              {
                messages: [
                  { role: "user", content: "Tell me about the weather." },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const promptText = "Count from 1 to 10 slowly.";

        await traced(
          async () => {
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
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            const agentStream = await agent.stream(
              {
                messages: [{ role: "user", content: promptText }],
              },
              { callbacks: [handler] },
            );
            for await (const chunk of agentStream) {
              if (chunk.content) {
                process.stdout.write(chunk.content.toString());
              }
            }
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const messages = [
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

        await traced(
          async () => {
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages,
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 150,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const messages = [
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
        await traced(
          async () => {
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages,
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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
        for (let i = 0; i < configs.length; i++) {
          const config = configs[i];
          const model = models[i];

          await traced(
            async () => {
              const prompt = ChatPromptTemplate.fromTemplate(
                "Say something {topic}.",
              );
              const chain = prompt.pipe(model);
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              await chain.invoke(
                {
                  topic: "creative",
                },
                { callbacks: [handler] },
              );
            },
            { name: `Chain (${provider} temp=${config.temperature})` },
          );

          await traced(
            async () => {
              const agent = createAgent({
                model,
              });
              await agent.invoke(
                {
                  messages: [
                    { role: "user", content: "Say something creative." },
                  ],
                },
                { callbacks: [handler] },
              );
            },
            { name: `Agent (${provider} temp=${config.temperature})` },
          );
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
        const topic = "robot";

        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromTemplate(
              `Write a short story about a ${topic}.`,
            );
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({}, { callbacks: [handler] });
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model,
            });
            await agent.invoke(
              {
                messages: [
                  {
                    role: "user",
                    content: `Write a short story about a ${topic}.`,
                  },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            modelKwargs: { user: "test_user_123" },
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        await traced(
          async () => {
            const messages = [new HumanMessage("Hello!")];
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [{ role: "user", content: "Hello!" }],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromTemplate(
              "Here is a long text:\n\n{text}\n\nHow many times does the word 'fox' appear?",
            );
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({ text: longText }, { callbacks: [handler] });
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [
                  {
                    role: "user",
                    content: `Here is a long text:\n\n${longText}\n\nHow many times does the word 'fox' appear?`,
                  },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const messages = [
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

        await traced(
          async () => {
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages,
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const topic = "coding";

        await traced(
          async () => {
            const messages = [
              new HumanMessage(`Write a haiku about ${topic}.`),
              new AIMessage("Here is a haiku:"),
            ];
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await model.invoke(messages);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [
                  { role: "user", content: `Write a haiku about ${topic}.` },
                  { role: "assistant", content: "Here is a haiku:" },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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
        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromTemplate("What is AI?");
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({});
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model,
            });
            await agent.invoke(
              {
                messages: [{ role: "user", content: "What is AI?" }],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const query = "What is the weather like in Paris, France?";

        await traced(
          async () => {
            const modelWithTools = model.bindTools([getWeatherTool]);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await modelWithTools.invoke(query);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              tools: [getWeatherTool],
            });
            await agent.invoke(
              {
                messages: [{ role: "user", content: query }],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const query = "What is 127 multiplied by 49?";

        await traced(
          async () => {
            const modelWithTools = model.bindTools([calculateTool]);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const firstResult = (await modelWithTools.invoke(
              query,
            )) as AIMessage;

            if (firstResult.tool_calls && firstResult.tool_calls.length > 0) {
              const toolCall = firstResult.tool_calls[0];
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
              await modelWithTools.invoke(messages);
            }
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              tools: [calculateTool],
            });
            await agent.invoke(
              {
                messages: [{ role: "user", content: query }],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 100,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 100,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const topic = "programming";

        await traced(
          async () => {
            const prompt = ChatPromptTemplate.fromTemplate(
              "Tell me a joke about {topic}.",
            );
            const chain = prompt.pipe(model);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await chain.invoke({ topic });
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            await agent.invoke(
              {
                messages: [
                  { role: "user", content: `Tell me a joke about ${topic}.` },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 200,
            streaming: true,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const category = "programming languages";

        await traced(
          async () => {
            const prompt =
              ChatPromptTemplate.fromTemplate("List 3 {category}.");
            const chain = prompt.pipe(model);
            const stream = await chain.stream({ category });
            for await (const chunk of stream) {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              const msg = chunk as BaseMessage;
              if (msg.content) {
                process.stdout.write(msg.content.toString());
              }
            }
          },
          { name: `Chain (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
            });
            const agentStream = await agent.stream(
              {
                messages: [{ role: "user", content: `List 3 ${category}.` }],
              },
              { callbacks: [handler] },
            );
            for await (const chunk of agentStream) {
              if (chunk.content) {
                process.stdout.write(chunk.content.toString());
              }
            }
          },
          { name: `Agent (${provider})` },
        );
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

      await traced(
        async () => {
          const prompt = ChatPromptTemplate.fromTemplate(
            "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
          );
          const chain = prompt.pipe(model);
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          await chain.invoke({});
        },
        { name: "Chain (anthropic)" },
      );

      await traced(
        async () => {
          const agent = createAgent({
            model,
          });
          await agent.invoke(
            {
              messages: [
                {
                  role: "user",
                  content:
                    "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
                },
              ],
            },
            { callbacks: [handler] },
          );
        },
        { name: "Agent (anthropic)" },
      );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const query =
          "I want to buy a laptop. Get the price from StoreA and StoreB, then apply the discount code SAVE20 to whichever is cheaper.";

        await traced(
          async () => {
            const modelWithTools = model.bindTools([
              getStorePriceTool,
              applyDiscountTool,
            ]);
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            await modelWithTools.invoke(query);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              tools: [getStorePriceTool, applyDiscountTool],
            });
            await agent.invoke(
              {
                messages: [
                  {
                    role: "user",
                    content: query,
                  },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const query = "Generate a simple recipe for chocolate chip cookies.";

        await traced(
          async () => {
            const structuredModel = model.withStructuredOutput(recipeSchema);
            await structuredModel.invoke(query);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              responseFormat: recipeSchema,
            });
            await agent.invoke(
              {
                messages: [
                  {
                    role: "user",
                    content: query,
                  },
                ],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
        const query =
          "Generate a product description for a wireless bluetooth headphone.";

        await traced(
          async () => {
            const structuredModel = model.withStructuredOutput(productSchema);
            const stream = await structuredModel.stream(query);
            for await (const chunk of stream) {
              // consume stream
            }
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              responseFormat: productSchema,
            });
            const agentStream = await agent.stream(
              {
                messages: [
                  {
                    role: "user",
                    content: query,
                  },
                ],
              },
              { callbacks: [handler] },
            );

            for await (const chunk of agentStream) {
              // consume stream
            }
          },
          { name: `Agent (${provider})` },
        );
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

      for (const [provider, model, agentModel] of [
        [
          "openai",
          new ChatOpenAI({
            model: "gpt-4o",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "openai:gpt-4o",
        ],
        [
          "anthropic",
          new ChatAnthropic({
            model: "claude-sonnet-4-20250514",
            maxTokens: 500,
            callbacks: [handler],
          }),
          "anthropic:claude-sonnet-4-20250514",
        ],
      ] as const) {
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

        const prompt = `Compare phone-123 and laptop-456. Here is the product info and reviews:

Product Info:
- phone-123: ${JSON.stringify(productInfo["phone-123"])}
- laptop-456: ${JSON.stringify(productInfo["laptop-456"])}

Reviews:
- phone-123: ${JSON.stringify(reviews["phone-123"])}
- laptop-456: ${JSON.stringify(reviews["laptop-456"])}

Give me a structured comparison with your recommendation.`;

        await traced(
          async () => {
            const structuredModel =
              model.withStructuredOutput(comparisonSchema);
            await structuredModel.invoke(prompt);
          },
          { name: `Model (${provider})` },
        );

        await traced(
          async () => {
            const agent = createAgent({
              model: agentModel,
              responseFormat: comparisonSchema,
            });
            await agent.invoke(
              {
                messages: [{ role: "user", content: prompt }],
              },
              { callbacks: [handler] },
            );
          },
          { name: `Agent (${provider})` },
        );
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
      console.error(`Test ${test.name} failed:`, error.message);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

runAllTests().catch(console.error);
