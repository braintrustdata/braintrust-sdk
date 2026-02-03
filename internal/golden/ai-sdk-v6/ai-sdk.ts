/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { wrapAISDK, initLogger, traced } from "braintrust";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as ai from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import type { LanguageModel } from "ai";

console.log("Running ai sdk version:", require("ai/package.json").version);
console.log(
  process.env.AI_GATEWAY_API_KEY
    ? "using ai gateway"
    : "using ai provider directly",
);

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

const gpt5mini = process.env.AI_GATEWAY_API_KEY
  ? "openai/gpt-5-mini"
  : openai("gpt-5-mini");

const gpt4o = process.env.AI_GATEWAY_API_KEY
  ? "openai/gpt-4o"
  : openai("gpt-4o");

const claudeSonnet45 = process.env.AI_GATEWAY_API_KEY
  ? "anthropic/claude-sonnet-4-5"
  : anthropic("claude-sonnet-4-5");

const claudeSonnet37 = process.env.AI_GATEWAY_API_KEY
  ? "anthropic/claude-3-7-sonnet-latest"
  : anthropic("claude-3-7-sonnet-latest");

initLogger({
  projectName: "golden-ts-ai-sdk-v6",
});

const {
  generateText,
  streamText,
  generateObject,
  streamObject,
  Experimental_Agent: Agent,
  ToolLoopAgent,
} = wrapAISDK(ai);

// Test 1: Basic completion
async function testBasicCompletion() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          prompt: "What is the capital of France?",
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          prompt: "What is the capital of France?",
        });
      }
    },
    { name: "test_basic_completion" },
  );
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          { role: "user" as const, content: "Hi, my name is Alice." },
          {
            role: "assistant" as const,
            content: "Hello Alice! Nice to meet you.",
          },
          {
            role: "user" as const,
            content: "What did I just tell you my name was?",
          },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_multi_turn" },
  );
}

// Test 3: System prompt
async function testSystemPrompt() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          system: "You are a pirate. Always respond in pirate speak.",
          prompt: "Tell me about the weather.",
        });

        await new Agent({
          model: model as LanguageModel,
          system: "You are a pirate. Always respond in pirate speak.",
        }).generate({
          prompt: "Tell me about the weather.",
        });
      }
    },
    { name: "test_system_prompt" },
  );
}

// Test 4: Streaming
async function testStreaming() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        const result = await streamText({
          model: model as LanguageModel,
          prompt: "Count from 1 to 10 slowly.",
        });

        for await (const _ of result.textStream) {
        }

        const agentResult = await new Agent({
          model: model as LanguageModel,
        }).stream({
          prompt: "Count from 1 to 10 slowly.",
        });

        for await (const _ of agentResult.textStream) {
        }
      }
    },
    { name: "test_streaming" },
  );
}

// Test 5: Image input
async function testImageInput() {
  return traced(
    async () => {
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          {
            role: "user" as const,
            content: [
              {
                type: "image" as const,
                image: `data:image/png;base64,${base64Image}`,
              },
              { type: "text" as const, text: "What color is this image?" },
            ],
          },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_image_input" },
  );
}

// Test 6: Document input
async function testDocumentInput() {
  return traced(
    async () => {
      const base64Pdf = readFileSync(
        `${FIXTURES_DIR}/test-document.pdf`,
        "base64",
      );

      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          {
            role: "user" as const,
            content: [
              {
                type: "file" as const,
                data: base64Pdf,
                mediaType: "application/pdf",
                filename: "test-document.pdf",
              },
              {
                type: "text" as const,
                text: "What is in this document?",
              },
            ],
          },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_document_input" },
  );
}

// Test 7: Temperature variations
async function testTemperatureVariations() {
  return traced(
    async () => {
      const openaiConfigs = [
        { temperature: 0.0, topP: 1.0 },
        { temperature: 1.0, topP: 0.9 },
        { temperature: 0.7, topP: 0.95 },
      ];

      // Anthropic only allows one at a time
      const anthropicConfigs = [
        { temperature: 0.0 },
        { temperature: 1.0 },
        { topP: 0.9 },
      ];

      for (const [model, configs] of [
        [gpt5mini, openaiConfigs],
        [claudeSonnet45, anthropicConfigs],
      ]) {
        // @ts-ignore
        for (const config of configs) {
          await generateText({
            model: model as LanguageModel,
            ...config,
            prompt: "Say something creative.",
          });

          await new Agent({
            model: model as LanguageModel,
            ...config,
          }).generate({
            prompt: "Say something creative.",
          });
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
      for (const [model, stopSequences] of [
        [gpt5mini, ["END", "\n\n"]],
        [claudeSonnet45, ["END"]],
      ] satisfies [LanguageModel, string[]][]) {
        await generateText({
          model: model as LanguageModel,
          stopSequences,
          prompt: "Write a short story about a robot.",
        });

        await new Agent({
          model: model as LanguageModel,
          stopSequences,
        }).generate({
          prompt: "Write a short story about a robot.",
        });
      }
    },
    { name: "test_stop_sequences" },
  );
}

// Test 9: Metadata with callOptionsSchema
async function testMetadata() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          prompt: "Hello!",
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          prompt: "Hello!",
        });

        // ToolLoopAgent with callOptionsSchema for metadata
        const supportAgent = new ToolLoopAgent({
          model: model as LanguageModel,
          callOptionsSchema: z.object({
            userId: z.string(),
            accountType: z.enum(["free", "pro", "enterprise"]),
          }),
          prepareCall: ({ options, ...settings }) => ({
            ...settings,
            system: `You are a helpful customer support agent.
- User Account type: ${options.accountType}
- User ID: ${options.userId}`,
          }),
        });

        await supportAgent.generate({
          prompt: "How do I upgrade my account?",
          options: {
            userId: "user_123",
            accountType: "free",
          },
        });
      }
    },
    { name: "test_metadata" },
  );
}

// Test 10: Long context
async function testLongContext() {
  return traced(
    async () => {
      const longText = "The quick brown fox jumps over the lazy dog. ".repeat(
        100,
      );

      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          {
            role: "user" as const,
            content: `Here is a long text:\n\n${longText}\n\nHow many times does the word "fox" appear?`,
          },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_long_context" },
  );
}

// Test 11: Mixed content types
async function testMixedContent() {
  return traced(
    async () => {
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "First, look at this image:" },
              {
                type: "image" as const,
                image: `data:image/png;base64,${base64Image}`,
              },
              {
                type: "text" as const,
                text: "Now describe what you see and explain why it matters.",
              },
            ],
          },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_mixed_content" },
  );
}

// Test 12: Prefill
async function testPrefill() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        const messages = [
          { role: "user" as const, content: "Write a haiku about coding." },
          { role: "assistant" as const, content: "Here is a haiku:" },
        ];

        await generateText({
          model: model as LanguageModel,
          messages,
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          messages,
        });
      }
    },
    { name: "test_prefill" },
  );
}

// Test 13: Very short max_tokens
async function testShortMaxTokens() {
  return traced(
    async () => {
      for (const model of [gpt4o, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          prompt: "What is AI?",
          maxOutputTokens: 16, // ai-sdk requirement for 16 or more
        });

        await new Agent({
          model: model as LanguageModel,
          maxOutputTokens: 16,
        }).generate({
          prompt: "What is AI?",
        });
      }
    },
    { name: "test_short_max_tokens" },
  );
}

interface WeatherToolArgs {
  location: string;
  unit?: "celsius" | "fahrenheit";
}

// Type for calculate tool args
interface CalculateToolArgs {
  operation: "add" | "subtract" | "multiply" | "divide";
  a: number;
  b: number;
}

// Type for store price tool args
interface StorePriceToolArgs {
  store: string;
  item: string;
}

// Type for discount tool args
interface ApplyDiscountToolArgs {
  total: number;
  discountCode: string;
}

// Test 14: Tool use with inputExamples
async function testToolUse() {
  return traced(
    async () => {
      const weatherTool = ai.tool({
        description: "Get the current weather for a location",
        inputSchema: z.object({
          location: z.string().describe("The location to get the weather for"),
          unit: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        inputExamples: [
          { input: { location: "San Francisco" } },
          { input: { location: "London" } },
          { input: { location: "Tokyo", unit: "celsius" } },
        ],
        execute: async (args: unknown) => {
          const typedArgs = args as WeatherToolArgs;
          return `22 degrees ${typedArgs.unit || "celsius"} and sunny in ${typedArgs.location}`;
        },
      });

      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          tools: {
            get_weather: weatherTool,
          },
          prompt: "What is the weather like in Paris, France?",
        });

        await new Agent({
          model: model as LanguageModel,
          tools: {
            get_weather: weatherTool,
          },
        }).generate({
          prompt: "What is the weather like in Paris, France?",
        });

        await new ToolLoopAgent({
          model: model as LanguageModel,
          tools: {
            get_weather: weatherTool,
          },
        }).generate({
          prompt: "What is the weather like in Paris, France?",
        });
      }
    },
    { name: "test_tool_use" },
  );
}

// Test 15: Tool use with result
async function testToolUseWithResult() {
  return traced(
    async () => {
      const calculateTool = {
        description: "Perform a mathematical calculation",
        inputSchema: z.object({
          operation: z.enum(["add", "subtract", "multiply", "divide"]),
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as CalculateToolArgs;
          switch (typedArgs.operation) {
            case "add":
              return String(typedArgs.a + typedArgs.b);
            case "subtract":
              return String(typedArgs.a - typedArgs.b);
            case "multiply":
              return String(typedArgs.a * typedArgs.b);
            case "divide":
              return typedArgs.b !== 0
                ? String(typedArgs.a / typedArgs.b)
                : "0";
            default:
              return "0";
          }
        },
      };

      const greetingTool = ai.tool({
        description: "A tool that streams a personalized greeting",
        inputSchema: z.object({ name: z.string() }),
        execute: async function* ({ name }: { name: string }) {
          yield { status: "starting", message: "Preparing..." };
          yield { status: "processing", message: `Looking up ${name}...` };
          yield { status: "done", greeting: `Hello, ${name}!` };
        },
      });

      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          tools: {
            calculate: calculateTool,
          },
          prompt: "What is 127 multiplied by 49? Use the calculate tool.",
          stopWhen: ai.stepCountIs(2),
        });

        await new Agent({
          model: model as LanguageModel,
          tools: {
            calculate: calculateTool,
          },
        }).generate({
          prompt: "What is 127 multiplied by 49?  Use the calculate tool.",
        });

        await new ToolLoopAgent({
          model: model as LanguageModel,
          tools: {
            calculate: calculateTool,
          },
        }).generate({
          prompt: "What is 127 multiplied by 49?  Use the calculate tool.",
        });

        await generateText({
          model: model as LanguageModel,
          tools: {
            greeting: greetingTool,
          },
          prompt: "Greet Alice using the greeting tool.",
          stopWhen: ai.stepCountIs(2),
        });
      }
    },
    { name: "test_tool_use_with_result" },
  );
}

// Test 16: Multi-round tool use (to see LLM ↔ tool roundtrips)
async function testMultiRoundToolUse() {
  return traced(
    async () => {
      const getStorePriceTool = ai.tool({
        description: "Get the price of an item from a specific store",
        inputSchema: z.object({
          store: z
            .string()
            .describe("The store name (e.g., 'StoreA', 'StoreB')"),
          item: z.string().describe("The item to get the price for"),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as StorePriceToolArgs;
          const prices: Record<string, Record<string, number>> = {
            StoreA: { laptop: 999, mouse: 25, keyboard: 75 },
            StoreB: { laptop: 1099, mouse: 20, keyboard: 80 },
          };
          const price = prices[typedArgs.store]?.[typedArgs.item] ?? 0;
          return JSON.stringify({
            store: typedArgs.store,
            item: typedArgs.item,
            price,
          });
        },
      });

      const applyDiscountTool = ai.tool({
        description: "Apply a discount code to a total amount",
        inputSchema: z.object({
          total: z.number().describe("The total amount before discount"),
          discountCode: z.string().describe("The discount code to apply"),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as ApplyDiscountToolArgs;
          const discounts: Record<string, number> = {
            SAVE10: 0.1,
            SAVE20: 0.2,
            HALF: 0.5,
          };
          const discountRate = discounts[typedArgs.discountCode] ?? 0;
          const discountAmount = typedArgs.total * discountRate;
          const finalTotal = typedArgs.total - discountAmount;
          return JSON.stringify({
            originalTotal: typedArgs.total,
            discountCode: typedArgs.discountCode,
            discountRate: `${discountRate * 100}%`,
            discountAmount,
            finalTotal,
          });
        },
      });

      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          system:
            "You are a shopping assistant. When asked about prices, always get the price from each store mentioned, then apply any discount codes. Use the tools provided.",
          tools: {
            get_store_price: getStorePriceTool,
            apply_discount: applyDiscountTool,
          },
          toolChoice: "required",
          prompt:
            "I want to buy a laptop. Get the price from StoreA and StoreB, then apply the discount code SAVE20 to whichever is cheaper.",
          stopWhen: ai.stepCountIs(3),
        });
      }
    },
    { name: "test_multi_round_tool_use" },
  );
}

// Test 17: Structured output
async function testStructuredOutput() {
  return traced(
    async () => {
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

      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateObject({
          model: model as LanguageModel,
          schema: recipeSchema,
          prompt: "Generate a simple recipe for chocolate chip cookies.",
        });
      }
    },
    { name: "test_structured_output" },
  );
}

// Test 18: Streaming structured output
async function testStreamingStructuredOutput() {
  return traced(
    async () => {
      const productSchema = z.object({
        name: z.string(),
        description: z.string(),
        price: z.number(),
        features: z.array(z.string()),
      });

      for (const model of [gpt5mini, claudeSonnet45]) {
        const result = streamObject({
          model: model as LanguageModel,
          schema: productSchema,
          prompt:
            "Generate a product description for a wireless bluetooth headphone.",
        });

        for await (const _ of result.partialObjectStream) {
        }
      }
    },
    { name: "test_streaming_structured_output" },
  );
}

// Test 18b: streamText with Output.object (structured output via output parameter)
async function testStreamTextWithOutputObject() {
  return traced(
    async () => {
      const analysisSchema = z.object({
        scratchpad: z.string().describe("Thinking through the problem"),
        answer: z.string().describe("The final answer"),
        confidence: z.number().describe("Confidence level from 0 to 1"),
      });

      const outputSchema = ai.Output.object({
        schema: analysisSchema,
      });

      for (const model of [gpt5mini, claudeSonnet45]) {
        // streamText with output parameter
        const streamResult = streamText({
          model: model as LanguageModel,
          output: outputSchema,
          messages: [
            {
              role: "user",
              content: "What is 15 * 23? Think through it step by step.",
            },
          ],
        });

        for await (const _ of streamResult.textStream) {
        }

        // Also test generateText with output parameter
        await generateText({
          model: model as LanguageModel,
          output: outputSchema,
          messages: [
            {
              role: "user",
              content: "What is 42 + 58? Think through it step by step.",
            },
          ],
        });
      }
    },
    { name: "test_stream_text_with_output_object" },
  );
}

// Test 19: Structured output with context (multi-turn with tools)
async function testStructuredOutputWithContext() {
  return traced(
    async () => {
      const getProductInfoTool = ai.tool({
        description: "Get product information including price and specs",
        inputSchema: z.object({
          productId: z.string(),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as { productId: string };
          const products: Record<
            string,
            { name: string; price: number; specs: string }
          > = {
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
          return (
            products[typedArgs.productId] || {
              name: "Unknown",
              price: 0,
              specs: "N/A",
            }
          );
        },
      });

      const getReviewsTool = ai.tool({
        description: "Get customer reviews for a product",
        inputSchema: z.object({
          productId: z.string(),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as { productId: string };
          const reviews: Record<
            string,
            { rating: number; comments: string[] }
          > = {
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
          return reviews[typedArgs.productId] || { rating: 0, comments: [] };
        },
      });

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

      for (const model of [gpt5mini, claudeSonnet45]) {
        await generateText({
          model: model as LanguageModel,
          tools: {
            get_product_info: getProductInfoTool,
            get_reviews: getReviewsTool,
          },
          toolChoice: "required",
          system:
            "You are a helpful shopping assistant. Use the tools to gather product information before making recommendations.",
          prompt:
            "Compare phone-123 and laptop-456. Look up their info and reviews, then give me a structured comparison with your recommendation.",
          experimental_output: ai.Output.object({ schema: comparisonSchema }),
          stopWhen: ai.stepCountIs(4),
        });
      }
    },
    { name: "test_structured_output_with_context" },
  );
}

// Test 20: ToolLoopAgent with structured output
async function testToolLoopAgentStructuredOutput() {
  return traced(
    async () => {
      for (const model of [gpt5mini, claudeSonnet45]) {
        const weatherAgent = new ToolLoopAgent({
          model: model as LanguageModel,
          tools: {
            weather: ai.tool({
              description: "Get the weather in a location",
              inputSchema: z.object({
                city: z.string().describe("The city to get weather for"),
              }),
              execute: async ({ city }: { city: string }) => {
                return `The weather in ${city} is 72°F and sunny`;
              },
            }),
          },
          output: ai.Output.object({
            schema: z.object({
              summary: z.string().describe("A brief summary of the weather"),
              temperature: z.number().describe("The temperature in Fahrenheit"),
              recommendation: z.string().describe("What the user should wear"),
            }),
          }),
        });

        await weatherAgent.generate({
          prompt:
            "What is the weather in San Francisco and what should I wear?",
        });
      }
    },
    { name: "test_toolloop_agent_structured_output" },
  );
}

// Test 21: Reasoning tokens generation and follow-up
async function testReasoning() {
  return traced(
    async () => {
      for (const [model, options] of [
        [
          gpt5mini,
          {
            providerOptions: {
              openai: {
                reasoningEffort: "high",
                reasoningSummary: "detailed",
              },
            },
          },
        ],
        [
          claudeSonnet37,
          {
            providerOptions: {
              anthropic: {
                thinking: {
                  type: "enabled",
                  budgetTokens: 10000,
                },
              },
            },
          },
        ],
      ]) {
        const messages = [
          {
            role: "user" as const,
            content:
              "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
          },
        ];

        const firstResult = await generateText({
          model: model as LanguageModel,
          messages,
          ...options,
        });

        await generateText({
          model: model as LanguageModel,
          messages: [
            ...messages,
            ...firstResult.response.messages,
            {
              role: "user" as const,
              content:
                "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
            },
          ],
          ...options,
        });

        const agent = new Agent({
          model: model as LanguageModel,
          ...options,
        });

        const agentFirstResult = await agent.generate({
          messages,
        });

        await agent.generate({
          messages: [
            ...messages,
            ...agentFirstResult.response.messages,
            {
              role: "user" as const,
              content:
                "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
            },
          ],
        });
      }
    },
    {
      name: "test_reasoning",
    },
  );
}

// Run all tests
async function runAllTests() {
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
    testMultiRoundToolUse,
    testStructuredOutput,
    testStreamingStructuredOutput,
    testStructuredOutputWithContext,
    testToolLoopAgentStructuredOutput,
    testReasoning,
    testStreamTextWithOutputObject,
  ];

  for (const test of tests) {
    try {
      await test();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error);
    }
  }
}

runAllTests().catch(console.error);
