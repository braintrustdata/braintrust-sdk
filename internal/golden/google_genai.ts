import { initLogger, traced } from "braintrust";
import * as googleGenAI from "@google/genai";
import { readFileSync } from "fs";
import { join } from "path";
import { wrapGoogleGenAI } from "braintrust";

const { GoogleGenAI } = wrapGoogleGenAI(googleGenAI);

const FIXTURES_DIR = join(__dirname, "fixtures");

initLogger({
  projectName: "golden-ts-genai",
});

const client = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

// Test 1: Basic text completion
async function testBasicCompletion() {
  return traced(
    async () => {
      console.log("\n=== Test 1: Basic Completion ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "What is the capital of France?",
        config: {
          maxOutputTokens: 100,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_basic_completion" },
  );
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
  return traced(
    async () => {
      console.log("\n=== Test 2: Multi-turn Conversation ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            role: "user",
            parts: [{ text: "Hi, my name is Alice." }],
          },
          {
            role: "model",
            parts: [{ text: "Hello Alice! Nice to meet you." }],
          },
          {
            role: "user",
            parts: [{ text: "What did I just tell you my name was?" }],
          },
        ],
        config: {
          maxOutputTokens: 200,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_multi_turn" },
  );
}

// Test 3: System prompt
async function testSystemPrompt() {
  return traced(
    async () => {
      console.log("\n=== Test 3: System Prompt ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "Tell me about the weather.",
        config: {
          systemInstruction:
            "You are a pirate. Always respond in pirate speak.",
          maxOutputTokens: 150,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_system_prompt" },
  );
}

// Test 4: Streaming response
async function testStreaming() {
  return traced(
    async () => {
      console.log("\n=== Test 4: Streaming ===");
      const stream = await client.models.generateContentStream({
        model: "gemini-2.0-flash-001",
        contents: "Count from 1 to 10 slowly.",
        config: {
          maxOutputTokens: 200,
        },
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.text) {
          process.stdout.write(chunk.text);
          fullText += chunk.text;
        }
      }

      console.log("\n");
      return fullText;
    },
    { name: "test_streaming" },
  );
}

// Test 5: Image input (base64)
async function testImageInput() {
  return traced(
    async () => {
      console.log("\n=== Test 5: Image Input ===");
      const imagePath = join(FIXTURES_DIR, "test-image.png");
      const imageData = readFileSync(imagePath);

      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: imageData.toString("base64"),
                  mimeType: "image/png",
                },
              },
              { text: "What color is this image?" },
            ],
          },
        ],
        config: {
          maxOutputTokens: 150,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_image_input" },
  );
}

// Test 6: Document input (PDF)
async function testDocumentInput() {
  return traced(
    async () => {
      console.log("\n=== Test 6: Document Input ===");
      const pdfPath = join(FIXTURES_DIR, "test-document.pdf");
      const pdfData = readFileSync(pdfPath);

      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: pdfData.toString("base64"),
                  mimeType: "application/pdf",
                },
              },
              { text: "What is in this document?" },
            ],
          },
        ],
        config: {
          maxOutputTokens: 150,
        },
      });
      console.log(response.text);
      return response;
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

      const responses = [];
      for (const config of configs) {
        console.log(
          `\nConfig: temp=${config.temperature}, topP=${config.topP}`,
        );
        const response = await client.models.generateContent({
          model: "gemini-2.0-flash-001",
          contents: "Say something creative.",
          config: {
            temperature: config.temperature,
            topP: config.topP,
            maxOutputTokens: 50,
          },
        });
        console.log(response.text);
        responses.push(response);
      }

      return responses;
    },
    { name: "test_temperature_variations" },
  );
}

// Test 8: Stop sequences
async function testStopSequences() {
  return traced(
    async () => {
      console.log("\n=== Test 8: Stop Sequences ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "Write a short story about a robot.",
        config: {
          maxOutputTokens: 500,
          stopSequences: ["END", "\n\n"],
        },
      });
      console.log(response.text);
      const finishReason = response.candidates?.[0]?.finishReason ?? "unknown";
      console.log(`Stop reason: ${finishReason}`);
      return response;
    },
    { name: "test_stop_sequences" },
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
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: `Here is a long text:\n\n${longText}\n\nHow many times does the word 'fox' appear?`,
        config: {
          maxOutputTokens: 100,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_long_context" },
  );
}

// Test 13: Mixed content types
async function testMixedContent() {
  return traced(
    async () => {
      console.log("\n=== Test 13: Mixed Content Types ===");
      const imagePath = join(FIXTURES_DIR, "test-image.png");
      const imageData = readFileSync(imagePath);

      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            parts: [
              { text: "First, look at this image:" },
              {
                inlineData: {
                  data: imageData.toString("base64"),
                  mimeType: "image/png",
                },
              },
              {
                text: "Now describe what you see and explain why it matters.",
              },
            ],
          },
        ],
        config: {
          maxOutputTokens: 200,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_mixed_content" },
  );
}

// Test 14: Empty assistant message (prefill)
async function testPrefill() {
  return traced(
    async () => {
      console.log("\n=== Test 14: Prefill ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            role: "user",
            parts: [{ text: "Write a haiku about coding." }],
          },
          {
            role: "model",
            parts: [{ text: "Here is a haiku:" }],
          },
        ],
        config: {
          maxOutputTokens: 200,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_prefill" },
  );
}

// Test 15: Very short max_tokens
async function testShortMaxTokens() {
  return traced(
    async () => {
      console.log("\n=== Test 15: Very Short Max Tokens ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "What is AI?",
        config: {
          maxOutputTokens: 5,
        },
      });
      console.log(response.text);
      const finishReason = response.candidates?.[0]?.finishReason ?? "unknown";
      console.log(`Stop reason: ${finishReason}`);
      return response;
    },
    { name: "test_short_max_tokens" },
  );
}

// Test 16: Tool use
async function testToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 16: Tool Use ===");

      const getWeather = {
        name: "get_weather",
        description: "Get the current weather for a location.",
        parametersJsonSchema: {
          type: "object",
          properties: {
            city_and_state: {
              type: "string",
              description: "The city and state, e.g. San Francisco, CA",
            },
            unit: {
              type: "string",
              enum: ["celsius", "fahrenheit"],
              description: "The unit of temperature",
            },
          },
          required: ["city_and_state"],
        },
      };

      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "What is the weather like in Paris, France?",
        config: {
          tools: [{ functionDeclarations: [getWeather] }],
          maxOutputTokens: 500,
        },
      });

      console.log("Response content:");
      if (response.text) {
        console.log(`Text: ${response.text}`);
      }

      if (response.functionCalls) {
        response.functionCalls.forEach((call, i) => {
          console.log(`Tool use block ${i}:`);
          console.log(`  Tool: ${call.name}`);
          console.log(`  Input: ${JSON.stringify(call.args)}`);
        });
      }

      return response;
    },
    { name: "test_tool_use" },
  );
}

// Test 17: Tool use with result (multi-turn)
async function testToolUseWithResult() {
  return traced(
    async () => {
      console.log("\n=== Test 17: Tool Use With Result ===");

      const calculateFunction = {
        name: "calculate",
        description: "Perform a mathematical calculation",
        parametersJsonSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["add", "subtract", "multiply", "divide"],
              description: "The mathematical operation",
            },
            a: {
              type: "number",
              description: "First number",
            },
            b: {
              type: "number",
              description: "Second number",
            },
          },
          required: ["operation", "a", "b"],
        },
      };

      const tool = { functionDeclarations: [calculateFunction] };

      const firstResponse = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "What is 127 multiplied by 49?",
        config: {
          tools: [tool],
          maxOutputTokens: 500,
        },
      });

      console.log("First response:");
      let toolCall = null;
      if (
        firstResponse.functionCalls &&
        firstResponse.functionCalls.length > 0
      ) {
        toolCall = firstResponse.functionCalls[0];
        console.log(`Tool called: ${toolCall.name}`);
        console.log(`Input: ${JSON.stringify(toolCall.args)}`);
      }

      const result = 127 * 49;

      if (!firstResponse.candidates || !toolCall || !toolCall.name) {
        throw new Error("Expected tool call in first response");
      }

      const secondResponse = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          {
            role: "user",
            parts: [{ text: "What is 127 multiplied by 49?" }],
          },
          firstResponse.candidates[0].content,
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: toolCall.name,
                  response: { result },
                },
              },
            ],
          },
        ],
        config: {
          tools: [tool],
          maxOutputTokens: 500,
        },
      });

      console.log("\nSecond response (with tool result):");
      console.log(secondResponse.text);
      return secondResponse;
    },
    { name: "test_tool_use_with_result" },
  );
}

// Test 18: Async generation
async function testAsyncGeneration() {
  return traced(
    async () => {
      console.log("\n=== Test 18: Async Generation ===");
      const response = await client.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: "Tell me a joke about programming.",
        config: {
          maxOutputTokens: 100,
        },
      });
      console.log(response.text);
      return response;
    },
    { name: "test_async_generation" },
  );
}

// Test 19: Async streaming
async function testAsyncStreaming() {
  return traced(
    async () => {
      console.log("\n=== Test 19: Async Streaming ===");
      const stream = await client.models.generateContentStream({
        model: "gemini-2.0-flash-001",
        contents: "List 5 programming languages and their main uses.",
        config: {
          maxOutputTokens: 200,
        },
      });

      let fullText = "";
      for await (const chunk of stream) {
        if (chunk.text) {
          process.stdout.write(chunk.text);
          fullText += chunk.text;
        }
      }

      console.log("\n");
      return fullText;
    },
    { name: "test_async_streaming" },
  );
}

// Test 20: Reasoning tokens generation and follow-up
async function testReasoning() {
  return traced(
    async () => {
      console.log("\n=== Test 20: Reasoning Tokens & Follow-up ===");

      console.log("\n--- First request (generate reasoning) ---");
      const firstResponse = await client.models.generateContent({
        model: "gemini-2.0-flash-thinking-exp-1219",
        contents:
          "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
        config: {
          maxOutputTokens: 2048,
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 1024,
          },
        },
      });

      console.log("First response:");
      console.log(firstResponse.candidates);

      console.log("\n--- Follow-up request (using reasoning context) ---");
      const followUpResponse = await client.models.generateContent({
        model: "gemini-2.0-flash-thinking-exp-1219",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
              },
            ],
          },
          firstResponse.candidates?.[0]?.content ?? {
            role: "model",
            parts: [],
          },
          {
            role: "user",
            parts: [
              {
                text: "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
              },
            ],
          },
        ],
        config: {
          maxOutputTokens: 2048,
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: 1024,
          },
        },
      });

      console.log("Follow-up response:");
      console.log(followUpResponse.candidates);

      return { firstResponse, followUpResponse };
    },
    { name: "test_reasoning" },
  );
}

async function runSyncTests() {
  const tests = [
    testBasicCompletion,
    testMultiTurn,
    testSystemPrompt,
    testStreaming,
    testImageInput,
    testDocumentInput,
    testTemperatureVariations,
    testStopSequences,
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
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e) {
      console.error(`Test ${test.name} failed:`, e);
    }
  }
}

async function runAsyncTests() {
  const tests = [testAsyncGeneration, testAsyncStreaming];

  for (const test of tests) {
    try {
      await test();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (e) {
      console.error(`Test ${test.name} failed:`, e);
    }
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Google GenAI Golden Tests with Braintrust");
  console.log("=".repeat(60));

  console.log("\n### Running Synchronous Tests ###");
  await runSyncTests();

  console.log("\n### Running Asynchronous Tests ###");
  await runAsyncTests();

  console.log("\n" + "=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

main().catch(console.error);
