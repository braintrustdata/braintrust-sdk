import { wrapAISDK, initLogger, traced } from "braintrust";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as ai from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
import type { LanguageModel } from "ai";

// Path from sdk/internal/golden/otel to sdk/fixtures
const FIXTURES_DIR = join(__dirname, "..", "fixtures");

// Initialize Braintrust logger
initLogger({
  projectName: "golden-ts-ai-sdk-otel",
});

// Wrap AI SDK with Braintrust
const {
  generateText,
  streamText,
  generateObject: _generateObject,
  streamObject: _streamObject,
} = wrapAISDK(ai);

// Test 1: Basic completion
async function testBasicCompletion() {
  return traced(
    async () => {
      console.log("\n=== Test 1: Basic Completion ===");

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "What is the capital of France?",
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            { role: "user", content: "Hi, my name is Alice." },
            { role: "assistant", content: "Hello Alice! Nice to meet you." },
            {
              role: "user",
              content: "What did I just tell you my name was?",
            },
          ],
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          system: "You are a pirate. Always respond in pirate speak.",
          prompt: "Tell me about the weather.",
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await streamText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "Count from 1 to 10 slowly.",
        });

        for await (const chunk of result.textStream) {
          process.stdout.write(chunk);
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
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  image: `data:image/png;base64,${base64Image}`,
                },
                { type: "text", text: "What color is this image?" },
              ],
            },
          ],
        });
        console.log(result.text);
        console.log();
      }
    },
    { name: "test_image_input" },
  );
}

// Test 6: Document input
async function testDocumentInput() {
  return traced(
    async () => {
      console.log("\n=== Test 6: Document Input ===");
      const base64Pdf = readFileSync(
        `${FIXTURES_DIR}/test-document.pdf`,
        "base64",
      );

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        // Note: PDF file support in AI SDK appears to be limited
        // OpenAI's AI SDK provider doesn't seem to process PDFs properly even with data URLs
        // Anthropic has general issues with the AI SDK provider (not PDF-specific)
        // This test demonstrates passing the file data correctly per AI SDK's FilePart interface
        const messages =
          provider === "openai"
            ? [
                {
                  role: "user" as const,
                  content: [
                    {
                      type: "file" as const,
                      file: {
                        file_data: `data:application/pdf;base64,${base64Pdf}`,
                        filename: "test-document.pdf",
                      },
                    },
                    {
                      type: "text" as const,
                      text: "What is in this document?",
                    },
                  ],
                },
              ]
            : [
                {
                  role: "user" as const,
                  content: [
                    {
                      type: "document" as const,
                      source: {
                        typ: "base64",
                        media_type: "application/pdf",
                        data: base64Pdf,
                      },
                    },
                    {
                      type: "text" as const,
                      text: "What is in this document?",
                    },
                  ],
                },
              ];

        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages,
        });
        console.log(result.text);
        console.log();
      }
    },
    { name: "test_document_input" },
  );
}

// Test 7: Temperature variations
async function testTemperatureVariations() {
  return traced(
    async () => {
      console.log("\n=== Test 7: Temperature Variations ===");

      const configs = [
        { temperature: 0.0, topP: 1.0 },
        { temperature: 1.0, topP: 0.9 },
        { temperature: 0.7, topP: 0.95 },
      ];

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        for (const config of configs) {
          console.log(
            `Config: temp=${config.temperature}, top_p=${config.topP}`,
          );
          const result = await generateText({
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            model: model as LanguageModel,
            temperature: config.temperature,
            topP: config.topP,
            prompt: "Say something creative.",
          });
          console.log(result.text);
        }
        console.log();
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const stopSequences = provider === "openai" ? ["END", "\n\n"] : ["END"];

        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          stopSequences,
          prompt: "Write a short story about a robot.",
        });
        console.log(result.text);
        console.log(`Stop reason: ${result.finishReason}`);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "Hello!",
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            {
              role: "user",
              content: `Here is a long text:\n\n${longText}\n\nHow many times does the word "fox" appear?`,
            },
          ],
        });
        console.log(result.text);
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
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "First, look at this image:" },
                {
                  type: "image",
                  image: `data:image/png;base64,${base64Image}`,
                },
                {
                  type: "text",
                  text: "Now describe what you see and explain why it matters.",
                },
              ],
            },
          ],
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            { role: "user", content: "Write a haiku about coding." },
            { role: "assistant", content: "Here is a haiku:" },
          ],
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "What is AI?",
        });
        console.log(result.text?.slice(0, 20) + "...");
        console.log(`Stop reason: ${result.finishReason}`);
        console.log();
      }
    },
    { name: "test_short_max_tokens" },
  );
}

// Type for weather tool args
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

// Test 14: Tool use
async function testToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 14: Tool Use ===");

      // Define tool with proper typing
      const weatherTool = {
        description: "Get the current weather for a location",
        inputSchema: z.object({
          location: z.string(),
          unit: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        execute: async (args: unknown) => {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const typedArgs = args as WeatherToolArgs;
          return `22 degrees ${typedArgs.unit || "celsius"} and sunny in ${typedArgs.location}`;
        },
      };

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        // @ts-ignore - Type instantiation depth issue with tools
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          tools: {
            get_weather: weatherTool,
          },
          prompt: "What is the weather like in Paris, France?",
        });

        console.log("Response content:");
        if (result.text) {
          console.log(`Text: ${result.text}`);
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          result.toolCalls.forEach((call, i) => {
            console.log(`Tool use block ${i}:`);
            console.log(`  Tool: ${call.toolName}`);
            if ("args" in call) {
              console.log(`  Input: ${JSON.stringify(call.args)}`);
            }
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

      // Define tool with proper typing
      const calculateTool = {
        description: "Perform a mathematical calculation",
        inputSchema: z.object({
          operation: z.enum(["add", "subtract", "multiply", "divide"]),
          a: z.number(),
          b: z.number(),
        }),
        execute: async (args: unknown) => {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

      for (const [provider, model] of [
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);

        // @ts-ignore - Type instantiation depth issue with tools
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          tools: {
            calculate: calculateTool,
          },
          prompt: "What is 127 multiplied by 49?",
        });

        console.log("First response:");
        if (result.toolCalls && result.toolCalls.length > 0) {
          const toolCall = result.toolCalls[0];
          console.log(`Tool called: ${toolCall.toolName}`);
          if ("args" in toolCall) {
            console.log(`Input: ${JSON.stringify(toolCall.args)}`);
          }
        }

        console.log("\nFinal response:");
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "Tell me a joke about programming.",
        });
        console.log(result.text);
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
        ["openai", openai("gpt-4o")],
        ["anthropic", anthropic("claude-3-5-sonnet-20241022")],
      ] as const) {
        console.log(`${provider.charAt(0).toUpperCase() + provider.slice(1)}:`);
        const result = await streamText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          prompt: "List 3 programming languages.",
        });

        for await (const chunk of result.textStream) {
          process.stdout.write(chunk);
        }
        console.log("\n");
      }
    },
    { name: "test_async_streaming" },
  );
}

// Interface for usage with reasoning tokens
interface UsageWithReasoning {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

// Test 18: Reasoning tokens generation and follow-up - ADDITIONAL TEST
async function testReasoning() {
  return traced(
    async () => {
      console.log("\n=== Test 18: Reasoning Tokens & Follow-up ===");

      for (const [provider, model, modelName] of [
        ["openai", openai("gpt-5-mini"), "gpt-5-mini"],
        [
          "anthropic",
          anthropic("claude-3-5-sonnet-20241022"),
          "claude-3-5-sonnet",
        ],
      ] as const) {
        console.log(
          `${provider.charAt(0).toUpperCase() + provider.slice(1)} (${modelName}):`,
        );

        // FIRST REQUEST: Analyze pattern and derive formula
        console.log("\n--- First request (generate reasoning) ---");
        const firstResult = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            {
              role: "user",
              content:
                "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
            },
          ],
        });

        if (!firstResult.reasoningText === undefined) {
          throw new Error("No reasoning text found.");
        }

        console.log("First response with reasoning:");
        console.log(firstResult.text);
        if (firstResult.reasoning && firstResult.reasoning.length > 0) {
          console.log(
            `Reasoning parts included: ${firstResult.reasoning.length}`,
          );
        }

        // Check if reasoning tokens are tracked
        if (firstResult.usage) {
          console.log("\nFirst request token usage:");
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const usage = firstResult.usage as UsageWithReasoning;
          console.log(`Prompt tokens: ${usage.promptTokens || "N/A"}`);
          console.log(`Completion tokens: ${usage.completionTokens || "N/A"}`);
          if (usage.reasoningTokens !== undefined) {
            console.log(`Reasoning tokens generated: ${usage.reasoningTokens}`);
          }
        }

        // SECOND REQUEST: Apply the discovered pattern to solve a new problem
        console.log("\n--- Follow-up request (using reasoning context) ---");

        const followUpResult = await generateText({
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          model: model as LanguageModel,
          messages: [
            {
              role: "user",
              content:
                "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
            },
            {
              role: "assistant",
              content: [
                {
                  type: "reasoning",
                  text: firstResult.reasoningText,
                },
                {
                  type: "text",
                  text: firstResult.text,
                },
              ],
            },
            {
              role: "user",
              content:
                "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
            },
          ],
        });

        console.log("Follow-up response:");
        console.log(followUpResult.text);

        if (followUpResult.usage) {
          console.log("\nFollow-up request token usage:");
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          const usage = followUpResult.usage as UsageWithReasoning;
          console.log(`Prompt tokens: ${usage.promptTokens || "N/A"}`);
          console.log(`Completion tokens: ${usage.completionTokens || "N/A"}`);
          if (usage.reasoningTokens !== undefined) {
            console.log(`Reasoning tokens: ${usage.reasoningTokens}`);
          }
        }
      }
    },
    {
      name: "testReasoning",
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
    testAsyncGeneration,
    testAsyncStreaming,
    testReasoning,
  ];

  for (const test of tests) {
    try {
      await test();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error);
    }
  }

  console.log("\n=== All tests completed ===");
}

runAllTests().catch(console.error);
