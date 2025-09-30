import { wrapOpenAI, initLogger } from "braintrust";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

// Path from sdk/js/examples/openai to sdk/fixtures
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "fixtures");

initLogger({
  projectName: "golden-ts-openai",
});

const client = wrapOpenAI(new OpenAI());

// Test 1: Basic text completion
async function testBasicCompletion() {
  console.log("\n=== Test 1: Basic Completion ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 100,
    messages: [{ role: "user", content: "What is the capital of France?" }],
  });
  console.log(response.choices[0].message.content);
  return response;
}

// Test 2: Multi-turn conversation
async function testMultiTurn() {
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
}

// Test 3: System prompt
async function testSystemPrompt() {
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
}

// Test 4: Streaming response
async function testStreaming() {
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
}

// Test 5: Image input (base64)
async function testImageInput() {
  console.log("\n=== Test 5: Image Input ===");
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What color is this image?",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
  });
  console.log(response.choices[0].message.content);
  return response;
}

// Test 6: Document analysis (using vision for PDF pages)
async function testDocumentAnalysis() {
  console.log("\n=== Test 6: Document Analysis ===");
  // Note: OpenAI doesn't directly support PDFs, but you can convert PDF pages to images
  // For this example, we'll simulate with text extraction
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content:
          "Analyze this document content: [Document placeholder - in production, extract PDF text or convert to images]",
      },
    ],
  });
  console.log(response.choices[0].message.content);
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
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 50,
      temperature: config.temperature,
      top_p: config.top_p,
      messages: [{ role: "user", content: "Say something creative." }],
    });
    console.log(response.choices[0].message.content);
  }
}

// Test 8: Stop sequences
async function testStopSequences() {
  console.log("\n=== Test 8: Stop Sequences ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 500,
    stop: ["END", "\n\n"],
    messages: [{ role: "user", content: "Write a short story about a robot." }],
  });
  console.log(response.choices[0].message.content);
  console.log(`Finish reason: ${response.choices[0].finish_reason}`);
  return response;
}

// Test 9: User parameter
async function testUserParameter() {
  console.log("\n=== Test 9: User Parameter ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 100,
    user: "test_user_123",
    messages: [{ role: "user", content: "Hello!" }],
  });
  console.log(response.choices[0].message.content);
  return response;
}

// Test 10: Long context
async function testLongContext() {
  console.log("\n=== Test 10: Long Context ===");
  const longText = "The quick brown fox jumps over the lazy dog. ".repeat(100);
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
}

// Test 11: JSON mode
async function testJsonMode() {
  console.log("\n=== Test 11: JSON Mode ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content:
          "Generate a JSON object with fields: name (string), age (number), and hobbies (array of strings).",
      },
    ],
  });
  console.log(response.choices[0].message.content);
  return response;
}

// Test 12: Multiple choices
async function testMultipleChoices() {
  console.log("\n=== Test 12: Multiple Choices ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 50,
    n: 3,
    temperature: 0.8,
    messages: [
      { role: "user", content: "Give me a creative name for a robot." },
    ],
  });
  console.log("Generated names:");
  response.choices.forEach((choice, i) => {
    console.log(`  ${i + 1}. ${choice.message.content}`);
  });
  return response;
}

// Test 13: Mixed content types
async function testMixedContent() {
  console.log("\n=== Test 13: Mixed Content Types ===");
  const base64Image = readFileSync(`${FIXTURES_DIR}/test-image.png`, "base64");

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
}

// Test 14: Seed parameter for deterministic output
async function testSeedParameter() {
  console.log("\n=== Test 14: Seed Parameter ===");
  const seed = 12345;

  const response1 = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 50,
    seed: seed,
    temperature: 0.7,
    messages: [{ role: "user", content: "Generate a random story opening." }],
  });

  const response2 = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 50,
    seed: seed,
    temperature: 0.7,
    messages: [{ role: "user", content: "Generate a random story opening." }],
  });

  console.log("First response:", response1.choices[0].message.content);
  console.log("Second response:", response2.choices[0].message.content);
  console.log(
    "Fingerprints match:",
    response1.system_fingerprint === response2.system_fingerprint,
  );
  return response1;
}

// Test 15: Very short max_tokens
async function testShortMaxTokens() {
  console.log("\n=== Test 15: Very Short Max Tokens ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 5,
    messages: [{ role: "user", content: "What is AI?" }],
  });
  console.log(response.choices[0].message.content);
  console.log(`Finish reason: ${response.choices[0].finish_reason}`);
  return response;
}

// Test 16: Function calling (tools)
async function testFunctionCalling() {
  console.log("\n=== Test 16: Function Calling ===");

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
    tool_choice: "auto",
    messages: [
      {
        role: "user",
        content: "What is the weather like in Paris, France?",
      },
    ],
  });

  console.log("Response:");
  const message = response.choices[0].message;
  if (message.content) {
    console.log(`Content: ${message.content}`);
  }
  if (message.tool_calls) {
    message.tool_calls.forEach((toolCall, i) => {
      console.log(`Tool call ${i}:`);
      console.log(`  Function: ${toolCall.function.name}`);
      console.log(`  Arguments: ${toolCall.function.arguments}`);
    });
  }
  console.log(`Finish reason: ${response.choices[0].finish_reason}`);
  return response;
}

// Test 17: Function calling with result (multi-turn)
async function testFunctionCallingWithResult() {
  console.log("\n=== Test 17: Function Calling With Result ===");

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

  // First request - OpenAI will use the function
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
    console.log(`Function called: ${toolCall.function.name}`);
    console.log(`Arguments: ${toolCall.function.arguments}`);

    // Parse arguments and simulate execution
    const result = 127 * 49;

    // Second request - provide function result
    const secondResponse = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 500,
      tools: tools,
      messages: [
        { role: "user", content: "What is 127 multiplied by 49?" },
        firstResponse.choices[0].message,
        {
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.toString(),
        },
      ],
    });

    console.log("\nSecond response (with function result):");
    console.log(secondResponse.choices[0].message.content);
    return secondResponse;
  } else {
    console.log("No function was called");
    return firstResponse;
  }
}

// Test 18: Logprobs
async function testLogprobs() {
  console.log("\n=== Test 18: Logprobs ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 20,
    logprobs: true,
    top_logprobs: 3,
    messages: [{ role: "user", content: "The capital of Japan is" }],
  });

  console.log("Response:", response.choices[0].message.content);

  const logprobs = response.choices[0].logprobs;
  if (logprobs) {
    console.log("\nTop logprobs for first few tokens:");
    logprobs.content?.slice(0, 3).forEach((token, i) => {
      console.log(`Token ${i}: "${token.token}"`);
      token.top_logprobs.forEach((prob) => {
        console.log(`  ${prob.token}: ${Math.exp(prob.logprob).toFixed(4)}`);
      });
    });
  }
  return response;
}

// Test 19: Frequency and presence penalty
async function testPenalties() {
  console.log("\n=== Test 19: Frequency and Presence Penalties ===");

  const configs = [
    { frequency_penalty: 0, presence_penalty: 0 },
    { frequency_penalty: 1, presence_penalty: 0 },
    { frequency_penalty: 0, presence_penalty: 1 },
  ];

  for (const config of configs) {
    console.log(
      `\nConfig: freq_penalty=${config.frequency_penalty}, pres_penalty=${config.presence_penalty}`,
    );
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 100,
      frequency_penalty: config.frequency_penalty,
      presence_penalty: config.presence_penalty,
      messages: [
        {
          role: "user",
          content:
            "Write a sentence about the ocean. Use the word 'water' as much as possible.",
        },
      ],
    });
    console.log(response.choices[0].message.content);
  }
}

// Test 20: Parallel function calling
async function testParallelFunctionCalling() {
  console.log("\n=== Test 20: Parallel Function Calling ===");

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
              description: "The city and state",
            },
          },
          required: ["location"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_time",
        description: "Get the current time in a location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city and state",
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
        content:
          "What's the weather and current time in both New York and Tokyo?",
      },
    ],
  });

  console.log("Response:");
  const message = response.choices[0].message;
  if (message.tool_calls && message.tool_calls.length > 1) {
    console.log(
      `Parallel function calls detected: ${message.tool_calls.length} calls`,
    );
    message.tool_calls.forEach((toolCall, i) => {
      console.log(
        `Call ${i + 1}: ${toolCall.function.name}(${toolCall.function.arguments})`,
      );
    });
  } else {
    console.log("Single or no function call");
    console.log(message);
  }
  return response;
}

// Run all tests
async function runAllTests() {
  const tests = [
    testBasicCompletion,
    testMultiTurn,
    testSystemPrompt,
    testStreaming,
    testImageInput,
    testDocumentAnalysis,
    testTemperatureVariations,
    testStopSequences,
    testUserParameter,
    testLongContext,
    testJsonMode,
    testMultipleChoices,
    testMixedContent,
    testSeedParameter,
    testShortMaxTokens,
    testFunctionCalling,
    testFunctionCallingWithResult,
    testLogprobs,
    testPenalties,
    testParallelFunctionCalling,
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
