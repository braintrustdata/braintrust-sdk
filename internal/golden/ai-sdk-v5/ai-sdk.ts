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

const { generateText, streamText, Experimental_Agent: Agent } = wrapAISDK(ai);

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

// Test 16: Reasoning tokens generation and follow-up
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
}

runAllTests().catch(console.error);
