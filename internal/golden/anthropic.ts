import { wrapAnthropic, initLogger } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

// Path from sdk/js/examples/anthropic to sdk/fixtures
const FIXTURES_DIR = join(__dirname, "fixtures");

initLogger({
  projectName: "golden-ts-anthropic",
});

const client = wrapAnthropic(new Anthropic());

// Test 1: Basic text completion
async function testBasicCompletion() {
  console.log("\n=== Test 1: Basic Completion ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [{ role: "user", content: "What is the capital of France?" }],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
  console.log("\n=== Test 2: Multi-turn Conversation ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      { role: "user", content: "Hi, my name is Alice." },
      { role: "assistant", content: "Hello Alice! Nice to meet you." },
      { role: "user", content: "What did I just tell you my name was?" },
    ],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 3: System prompt
async function testSystemPrompt() {
  console.log("\n=== Test 3: System Prompt ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 150,
    system: "You are a pirate. Always respond in pirate speak.",
    messages: [{ role: "user", content: "Tell me about the weather." }],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 4: Streaming response
async function testStreaming() {
  console.log("\n=== Test 4: Streaming ===");
  const stream = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{ role: "user", content: "Count from 1 to 10 slowly." }],
    stream: true,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      process.stdout.write(event.delta.text);
    }
  }
  console.log("\n");
}

// Test 5: Image input (base64)
async function testImageInput() {
  console.log("\n=== Test 5: Image Input ===");
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64Image,
            },
          },
          { type: "text", text: "What color is this image?" },
        ],
      },
    ],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 6: Document input (PDF)
async function testDocumentInput() {
  console.log("\n=== Test 6: Document Input ===");
  const base64Pdf = readFileSync(`${FIXTURES_DIR}/test-document.pdf`, "base64");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          { type: "text", text: "What is in this document?" },
        ],
      },
    ],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 7: Temperature and top_p variations
async function testTemperatureVariations() {
  console.log("\n=== Test 7: Temperature Variations ===");

  const configs = [
    { temperature: 0.0, top_p: 1.0 },
    { temperature: 1.0, top_p: 0.9 },
    { temperature: 0.7, top_p: 0.95 },
  ];

  for (const config of configs) {
    console.log(`\nConfig: temp=${config.temperature}, top_p=${config.top_p}`);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      temperature: config.temperature,
      top_p: config.top_p,
      messages: [{ role: "user", content: "Say something creative." }],
    });
    console.log(response.content[0].text);
  }
}

// Test 8: Stop sequences
async function testStopSequences() {
  console.log("\n=== Test 8: Stop Sequences ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    stop_sequences: ["END", "\n\n"],
    messages: [{ role: "user", content: "Write a short story about a robot." }],
  });
  console.log(response.content[0].text);
  console.log(`Stop reason: ${response.stop_reason}`);
  return response;
}

// Test 9: Metadata
async function testMetadata() {
  console.log("\n=== Test 9: Metadata ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    metadata: {
      user_id: "test_user_123",
    },
    messages: [{ role: "user", content: "Hello!" }],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 10: Long context
async function testLongContext() {
  console.log("\n=== Test 10: Long Context ===");
  const longText = "The quick brown fox jumps over the lazy dog. ".repeat(100);
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `Here is a long text:\n\n${longText}\n\nHow many times does the word "fox" appear?`,
      },
    ],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 13: Mixed content types
async function testMixedContent() {
  console.log("\n=== Test 13: Mixed Content Types ===");
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "First, look at this image:" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64Image,
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
  console.log(response.content[0].text);
  return response;
}

// Test 12: Empty assistant message (prefill)
async function testPrefill() {
  console.log("\n=== Test 14: Prefill ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      { role: "user", content: "Write a haiku about coding." },
      { role: "assistant", content: "Here is a haiku:" },
    ],
  });
  console.log(response.content[0].text);
  return response;
}

// Test 13: Very short max_tokens
async function testShortMaxTokens() {
  console.log("\n=== Test 15: Very Short Max Tokens ===");
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 5,
    messages: [{ role: "user", content: "What is AI?" }],
  });
  console.log(response.content[0].text);
  console.log(`Stop reason: ${response.stop_reason}`);
  return response;
}

// Test 14: Tool use (function calling)
async function testToolUse() {
  console.log("\n=== Test 16: Tool Use ===");

  const tools = [
    {
      name: "get_weather",
      description: "Get the current weather for a location",
      input_schema: {
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
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
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
  response.content.forEach((block, i) => {
    if (block.type === "text") {
      console.log(`Text block ${i}: ${block.text}`);
    } else if (block.type === "tool_use") {
      console.log(`Tool use block ${i}:`);
      console.log(`  Tool: ${block.name}`);
      console.log(`  Input: ${JSON.stringify(block.input, null, 2)}`);
    }
  });

  console.log(`Stop reason: ${response.stop_reason}`);
  return response;
}

// Test 15: Tool use with tool result (multi-turn)
async function testToolUseWithResult() {
  console.log("\n=== Test 17: Tool Use With Result ===");

  const tools = [
    {
      name: "calculate",
      description: "Perform a mathematical calculation",
      input_schema: {
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
  ];

  // First request - Claude will use the tool
  const firstResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
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
  const toolUseBlock = firstResponse.content.find(
    (block) => block.type === "tool_use",
  );
  if (toolUseBlock) {
    console.log(`Tool called: ${toolUseBlock.name}`);
    console.log(`Input: ${JSON.stringify(toolUseBlock.input, null, 2)}`);
  }

  // Simulate tool execution
  const result = 127 * 49;

  // Second request - provide tool result
  const secondResponse = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    tools: tools,
    messages: [
      { role: "user", content: "What is 127 multiplied by 49?" },
      { role: "assistant", content: firstResponse.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseBlock.id,
            content: result.toString(),
          },
        ],
      },
    ],
  });

  console.log("\nSecond response (with tool result):");
  console.log(secondResponse.content[0].text);
  return secondResponse;
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
