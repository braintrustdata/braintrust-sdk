/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { context, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as ai from "ai";
import { readFileSync } from "fs";
import { join } from "path";
import { BraintrustExporter } from "@braintrust/otel";
import type { LanguageModel } from "ai";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

console.log("Running ai sdk version:", require("ai/package.json").version);

let exporter: BraintrustExporter;
let sdk: NodeSDK;

function setupTracer() {
  exporter = new BraintrustExporter({
    parent: "project_name:golden-ts-ai-sdk-v5-otel",
    filterAISpans: true,
  });

  sdk = new NodeSDK({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  sdk.start();
}

// Test 1: Basic completion
async function testBasicCompletion() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      prompt: "What is the capital of France?",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_basic_completion",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      prompt: "What is the capital of France?",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_basic_completion",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
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

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_multi_turn",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_multi_turn",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 3: System prompt
async function testSystemPrompt() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      system: "You are a pirate. Always respond in pirate speak.",
      prompt: "Tell me about the weather.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_system_prompt",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
      system: "You are a pirate. Always respond in pirate speak.",
    }).generate({
      prompt: "Tell me about the weather.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_system_prompt",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 4: Streaming
async function testStreaming() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    const result = ai.streamText({
      model: model as LanguageModel,
      prompt: "Count from 1 to 10 slowly.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_streaming",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    for await (const _ of result.textStream) {
    }

    const agentResult = new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).stream({
      prompt: "Count from 1 to 10 slowly.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_streaming",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    for await (const _ of agentResult.textStream) {
    }
  }
}

// Test 5: Image input
async function testImageInput() {
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
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

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_image_input",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_image_input",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 6: Document input
async function testDocumentInput() {
  const base64Pdf = readFileSync(`${FIXTURES_DIR}/test-document.pdf`, "base64");

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
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

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_document_input",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_document_input",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 7: Temperature variations
async function testTemperatureVariations() {
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
      await ai.generateText({
        model: model as LanguageModel,
        ...config,
        prompt: "Say something creative.",
        experimental_telemetry: {
          isEnabled: true,
          functionId: "test_temperature_variations",
          metadata: { golden: true, sdkVersion: "v5" },
        },
      });

      await new ai.Experimental_Agent({
        model: model as LanguageModel,
        ...config,
      }).generate({
        prompt: "Say something creative.",
        experimental_telemetry: {
          isEnabled: true,
          functionId: "test_temperature_variations",
          metadata: { golden: true, sdkVersion: "v5" },
        },
      });
    }
  }
}

// Test 8: Stop sequences
async function testStopSequences() {
  for (const [model, stopSequences] of [
    [openai("gpt-5-mini"), ["END", "\n\n"]],
    [anthropic("claude-sonnet-4-5"), ["END"]],
  ] satisfies [LanguageModel, string[]][]) {
    await ai.generateText({
      model: model as LanguageModel,
      stopSequences,
      prompt: "Write a short story about a robot.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_stop_sequences",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
      stopSequences,
    }).generate({
      prompt: "Write a short story about a robot.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_stop_sequences",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 9: Metadata
async function testMetadata() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      prompt: "Hello!",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_metadata",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      prompt: "Hello!",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_metadata",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 10: Long context
async function testLongContext() {
  const longText = "The quick brown fox jumps over the lazy dog. ".repeat(100);

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    const messages = [
      {
        role: "user" as const,
        content: `Here is a long text:\n\n${longText}\n\nHow many times does the word "fox" appear?`,
      },
    ];

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_long_context",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_long_context",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 11: Mixed content types
async function testMixedContent() {
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
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

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_mixed_content",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_mixed_content",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 12: Prefill
async function testPrefill() {
  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    const messages = [
      { role: "user" as const, content: "Write a haiku about coding." },
      { role: "assistant" as const, content: "Here is a haiku:" },
    ];

    await ai.generateText({
      model: model as LanguageModel,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_prefill",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
    }).generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_prefill",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 13: Very short max_tokens
async function testShortMaxTokens() {
  for (const model of [openai("gpt-4o"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      prompt: "What is AI?",
      maxOutputTokens: 16, // ai-sdk requirement for 16 or more
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_short_max_tokens",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
      maxOutputTokens: 16,
    }).generate({
      prompt: "What is AI?",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_short_max_tokens",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
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

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      tools: {
        get_weather: weatherTool,
      },
      prompt: "What is the weather like in Paris, France?",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_tool_use",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
      tools: {
        get_weather: weatherTool,
      },
    }).generate({
      prompt: "What is the weather like in Paris, France?",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_tool_use",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 15: Tool use with result
async function testToolUseWithResult() {
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
          return typedArgs.b !== 0 ? String(typedArgs.a / typedArgs.b) : "0";
        default:
          return "0";
      }
    },
  };

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
      model: model as LanguageModel,
      tools: {
        calculate: calculateTool,
      },
      prompt: "What is 127 multiplied by 49? Use the calculate tool.",
      stopWhen: ai.stepCountIs(2),
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_tool_use_with_result",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await new ai.Experimental_Agent({
      model: model as LanguageModel,
      tools: {
        calculate: calculateTool,
      },
    }).generate({
      prompt: "What is 127 multiplied by 49?  Use the calculate tool.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_tool_use_with_result",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 16: Multi-round tool use (to see LLM ↔ tool roundtrips)
async function testMultiRoundToolUse() {
  const getStorePriceTool = ai.tool({
    description: "Get the price of an item from a specific store",
    inputSchema: z.object({
      store: z.string().describe("The store name (e.g., 'StoreA', 'StoreB')"),
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
    // @ts-ignore - Type instantiation depth issue with tools
    await ai.generateText({
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_multi_round_tool_use",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 18: Reasoning tokens generation and follow-up - ADDITIONAL TEST
async function testReasoning() {
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

    const firstResult = await ai.generateText({
      model: model as LanguageModel,
      messages,
      ...options,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_reasoning",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    await ai.generateText({
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_reasoning",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    const agent = new ai.Experimental_Agent({
      model: model as LanguageModel,
      ...options,
    });

    const agentFirstResult = await agent.generate({
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_reasoning",
        metadata: { golden: true, sdkVersion: "v5" },
      },
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_reasoning",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 18: Structured output
async function testStructuredOutput() {
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

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateObject({
      model: model as LanguageModel,
      schema: recipeSchema,
      prompt: "Generate a simple recipe for chocolate chip cookies.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_structured_output",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Test 19: Streaming structured output
async function testStreamingStructuredOutput() {
  const productSchema = z.object({
    name: z.string(),
    description: z.string(),
    price: z.number(),
    features: z.array(z.string()),
  });

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    const result = ai.streamObject({
      model: model as LanguageModel,
      schema: productSchema,
      prompt:
        "Generate a product description for a wireless bluetooth headphone.",
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_streaming_structured_output",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });

    for await (const _ of result.partialObjectStream) {
    }
  }
}

// Test 20: Structured output with context (multi-turn with tools)
// Uses tools to force multiple rounds before producing structured output
async function testStructuredOutputWithContext() {
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
      const reviews: Record<string, { rating: number; comments: string[] }> = {
        "phone-123": {
          rating: 4.5,
          comments: ["Great camera!", "Battery lasts all day", "A bit pricey"],
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

  for (const model of [openai("gpt-5-mini"), anthropic("claude-sonnet-4-5")]) {
    await ai.generateText({
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
      experimental_telemetry: {
        isEnabled: true,
        functionId: "test_structured_output_with_context",
        metadata: { golden: true, sdkVersion: "v5" },
      },
    });
  }
}

// Run all tests
async function runAllTests() {
  setupTracer();

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

  const tracer = trace.getTracer("ai-sdk-v5-otel-golden");

  for (const test of tests) {
    try {
      // Create a parent span for each test to group all operations
      const parentSpan = tracer.startSpan(test.name);
      const ctx = trace.setSpan(context.active(), parentSpan);

      await context.with(ctx, async () => {
        await test();
      });

      parentSpan.end();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(error);
    }
  }

  await exporter.forceFlush();
  await sdk.shutdown();

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

runAllTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
