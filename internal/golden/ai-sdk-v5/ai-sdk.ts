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

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

initLogger({
  projectName: "golden-ts-ai-sdk-v5",
});

const {
  generateText,
  streamText,
  generateObject,
  streamObject,
  Experimental_Agent: Agent,
} = wrapAISDK(ai);

// Test 1: Basic completion
async function testBasicCompletion() {
  return traced(
    async () => {
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
        [openai("gpt-5-mini"), openaiConfigs],
        [anthropic("claude-sonnet-4-5"), anthropicConfigs],
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
        [openai("gpt-5-mini"), ["END", "\n\n"]],
        [anthropic("claude-sonnet-4-5"), ["END"]],
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

// Test 9: Metadata
async function testMetadata() {
  return traced(
    async () => {
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
        await generateText({
          model: model as LanguageModel,
          prompt: "Hello!",
        });

        await new Agent({
          model: model as LanguageModel,
        }).generate({
          prompt: "Hello!",
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      for (const model of [openai("gpt-4o"), anthropic("claude-sonnet-4-5")]) {
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

// Test 14: Tool use
async function testToolUse() {
  return traced(
    async () => {
      const weatherTool = ai.tool({
        description: "Get the current weather for a location",
        inputSchema: z.object({
          location: z.string(),
          unit: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        execute: async (args: unknown) => {
          const typedArgs = args as WeatherToolArgs;
          return `22 degrees ${typedArgs.unit || "celsius"} and sunny in ${typedArgs.location}`;
        },
      });

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
      }
    },
    { name: "test_tool_use_with_result" },
  );
}

// Test 16: Multi-round tool use (to see LLM ↔ tool roundtrips)
async function testMultiRoundToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 16: Multi-Round Tool Use ===");

      const getStorePriceTool = ai.tool({
        description: "Get the price of an item from a specific store",
        inputSchema: z.object({
          store: z
            .string()
            .describe("The store name (e.g., 'StoreA', 'StoreB')"),
          item: z.string().describe("The item to get the price for"),
        }),
        execute: async (args: unknown) => {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

      for (const [provider, model] of [
        ["openai", openai("gpt-5-mini")],
        ["anthropic", anthropic("claude-sonnet-4-5")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        // @ts-ignore - Type instantiation depth issue with tools
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

        console.log("\nRoundtrip summary:");
        console.log(`Total tool calls: ${result.toolCalls?.length ?? 0}`);
        console.log(`Total tool results: ${result.toolResults?.length ?? 0}`);

        if (result.toolCalls && result.toolCalls.length > 0) {
          result.toolCalls.forEach((call, i) => {
            console.log(`  Tool call ${i + 1}: ${call.toolName}`);
            if ("args" in call) {
              console.log(`    Args: ${JSON.stringify(call.args)}`);
            }
          });
        }

        if (result.toolResults && result.toolResults.length > 0) {
          result.toolResults.forEach((res, i) => {
            console.log(`  Tool result ${i + 1}: ${res.toolName}`);
            console.log(`    Result: ${JSON.stringify(res.result)}`);
          });
        }

        console.log("\nFinal response:");
        console.log(result.text);
        console.log(`Steps count: ${result.steps?.length ?? 0}`);
        result.steps?.forEach((step, i) => {
          console.log(
            `  Step ${i + 1}: ${step.toolCalls?.length ?? 0} tool calls`,
          );
        });
        console.log();
      }
    },
    { name: "test_multi_round_tool_use" },
  );
}

// Test 18: Reasoning tokens generation and follow-up - ADDITIONAL TEST
async function testReasoning() {
  return traced(
    async () => {
      for (const [model, options] of [
        [
          openai("gpt-5-mini"),
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
          anthropic("claude-3-7-sonnet-latest"),
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

// Test 18: Structured output
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

// Test 19: Streaming structured output
async function testStreamingStructuredOutput() {
  return traced(
    async () => {
      const productSchema = z.object({
        name: z.string(),
        description: z.string(),
        price: z.number(),
        features: z.array(z.string()),
      });

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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

// Test 20: Structured output with context (multi-turn with tools)
// Uses tools to force multiple rounds before producing structured output
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

      for (const model of [
        openai("gpt-5-mini"),
        anthropic("claude-sonnet-4-5"),
      ]) {
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
    testReasoning,
    testStructuredOutput,
    testStreamingStructuredOutput,
    testStructuredOutputWithContext,
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
