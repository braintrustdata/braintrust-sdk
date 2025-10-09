import { wrapOpenAI, initLogger, traced } from "braintrust";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

// Path from sdk/js/examples/openai to sdk/fixtures
const FIXTURES_DIR = join(__dirname, "fixtures");

initLogger({
  projectName: "golden-ts-openai",
});

const client = wrapOpenAI(new OpenAI());

// Test 1: Basic text completion
async function testBasicCompletion() {
  return traced(
    async () => {
      console.log("\n=== Test 1: Basic Completion ===");
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 100,
        messages: [{ role: "user", content: "What is the capital of France?" }],
      });
      console.log(response.choices[0].message.content);
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
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 200,
        messages: [
          { role: "user", content: "Hi, my name is Alice." },
          { role: "assistant", content: "Hello Alice! Nice to meet you." },
          { role: "user", content: "What did I just tell you my name was?" },
        ],
      });
      console.log(response.choices[0].message.content);
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
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content: "You are a pirate. Always respond in pirate speak.",
          },
          { role: "user", content: "Tell me about the weather." },
        ],
      });
      console.log(response.choices[0].message.content);
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
      const stream = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 200,
        messages: [{ role: "user", content: "Count from 1 to 10 slowly." }],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          process.stdout.write(content);
        }
      }
      console.log("\n");
    },
    { name: "test_streaming" },
  );
}

// Test 5: Image input (base64)
async function testImageInput() {
  return traced(
    async () => {
      console.log("\n=== Test 5: Image Input ===");
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
              { type: "text", text: "What color is this image?" },
            ],
          },
        ],
      });
      console.log(response.choices[0].message.content);
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
      const base64Pdf = readFileSync(
        `${FIXTURES_DIR}/test-document.pdf`,
        "base64",
      );

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "file",
                file: {
                  file_data: `data:application/pdf;base64,${base64Pdf}`,
                  filename: "test-document.pdf",
                },
              },
              { type: "text", text: "What is in this document?" },
            ],
          },
        ],
      });
      console.log(response.choices[0].message.content);
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
        { temperature: 0.0, top_p: 1.0 },
        { temperature: 1.0, top_p: 0.9 },
        { temperature: 0.7, top_p: 0.95 },
      ];

      for (const config of configs) {
        console.log(
          `\nConfig: temp=${config.temperature}, top_p=${config.top_p}`,
        );
        const response = await client.chat.completions.create({
          model: "gpt-4o",
          max_tokens: 50,
          temperature: config.temperature,
          top_p: config.top_p,
          messages: [{ role: "user", content: "Say something creative." }],
        });
        console.log(response.choices[0].message.content);
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
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        stop: ["END", "\n\n"],
        messages: [
          { role: "user", content: "Write a short story about a robot." },
        ],
      });
      console.log(response.choices[0].message.content);
      console.log(`Stop reason: ${response.choices[0].finish_reason}`);
      return response;
    },
    { name: "test_stop_sequences" },
  );
}

// Test 9: Metadata
async function testMetadata() {
  return traced(
    async () => {
      console.log("\n=== Test 9: Metadata ===");
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 100,
        user: "test_user_123",
        messages: [{ role: "user", content: "Hello!" }],
      });
      console.log(response.choices[0].message.content);
      return response;
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
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: `Here is a long text:\n\n${longText}\n\nHow many times does the word "fox" appear?`,
          },
        ],
      });
      console.log(response.choices[0].message.content);
      return response;
    },
    { name: "test_long_context" },
  );
}

// Test 11: Mixed content types
async function testMixedContent() {
  return traced(
    async () => {
      console.log("\n=== Test 13: Mixed Content Types ===");
      const base64Image = readFileSync(
        `${FIXTURES_DIR}/test-image.png`,
        "base64",
      );

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "First, look at this image:" },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
              {
                type: "text",
                text: "Now describe what you see and explain why it matters.",
              },
            ],
          },
        ],
      });
      console.log(response.choices[0].message.content);
      return response;
    },
    { name: "test_mixed_content" },
  );
}

// Test 12: Empty assistant message (prefill)
async function testPrefill() {
  return traced(
    async () => {
      console.log("\n=== Test 14: Prefill ===");
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 200,
        messages: [
          { role: "user", content: "Write a haiku about coding." },
          { role: "assistant", content: "Here is a haiku:" },
        ],
      });
      console.log(response.choices[0].message.content);
      return response;
    },
    { name: "test_prefill" },
  );
}

// Test 13: Very short max_tokens
async function testShortMaxTokens() {
  return traced(
    async () => {
      console.log("\n=== Test 15: Very Short Max Tokens ===");
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 5,
        messages: [{ role: "user", content: "What is AI?" }],
      });
      console.log(response.choices[0].message.content);
      console.log(`Stop reason: ${response.choices[0].finish_reason}`);
      return response;
    },
    { name: "test_short_max_tokens" },
  );
}

// Test 14: Tool use (function calling)
async function testToolUse() {
  return traced(
    async () => {
      console.log("\n=== Test 16: Tool Use ===");

      const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get the current weather for a location",
            parameters: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The city and state, e.g. San Francisco, CA",
                },
                unit: {
                  type: "string",
                  enum: ["celsius", "fahrenheit"],
                  description: "The unit of temperature",
                },
              },
              required: ["location"],
            },
          },
        },
      ];

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        tools: tools,
        messages: [
          {
            role: "user",
            content: "What is the weather like in Paris, France?",
          },
        ],
      });

      console.log("Response content:");
      response.choices[0].message.tool_calls?.forEach((toolCall, i) => {
        console.log(`Tool use block ${i}:`);
        console.log(`  Tool: ${toolCall.function.name}`);
        console.log(`  Input: ${toolCall.function.arguments}`);
      });
      if (response.choices[0].message.content) {
        console.log(`Text: ${response.choices[0].message.content}`);
      }

      console.log(`Stop reason: ${response.choices[0].finish_reason}`);
      return response;
    },
    { name: "test_tool_use" },
  );
}

// Test 15: Tool use with tool result (multi-turn)
async function testToolUseWithResult() {
  return traced(
    async () => {
      console.log("\n=== Test 17: Tool Use With Result ===");

      const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "calculate",
            description: "Perform a mathematical calculation",
            parameters: {
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
          },
        },
      ];

      // First request - OpenAI will use the tool
      const firstResponse = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        tools: tools,
        messages: [
          {
            role: "user",
            content: "What is 127 multiplied by 49?",
          },
        ],
      });

      console.log("First response:");
      const toolCall = firstResponse.choices[0].message.tool_calls?.[0];
      if (toolCall) {
        console.log(`Tool called: ${toolCall.function.name}`);
        console.log(`Input: ${toolCall.function.arguments}`);
      }

      // Simulate tool execution
      const result = 127 * 49;

      // Second request - provide tool result
      const secondResponse = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        tools: tools,
        messages: [
          { role: "user", content: "What is 127 multiplied by 49?" },
          firstResponse.choices[0].message,
          {
            role: "tool",
            tool_call_id: toolCall!.id,
            content: result.toString(),
          },
        ],
      });

      console.log("\nSecond response (with tool result):");
      console.log(secondResponse.choices[0].message.content);
      return secondResponse;
    },
    { name: "test_tool_use_with_result" },
  );
}

// Run all tests
async function runAllTests() {
  const tests = [
    // testBasicCompletion,
    // testMultiTurn,
    // testSystemPrompt,
    // testStreaming,
    // testImageInput,
    testDocumentInput,
    // testTemperatureVariations,
    // testStopSequences,
    // testMetadata,
    // testLongContext,
    // testMixedContent,
    // testPrefill,
    // testShortMaxTokens,
    // testToolUse,
    // testToolUseWithResult,
  ];

  for (const test of tests) {
    try {
      await test();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limiting
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error.message);
    }
  }
}

runAllTests().catch(console.error);
