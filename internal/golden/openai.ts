import { wrapOpenAI, initLogger, traced } from "braintrust";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";

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

// Test 16: Reasoning tokens generation and follow-up
async function testReasoning() {
  return traced(
    async () => {
      console.log("\n=== Test 18: Reasoning Tokens & Follow-up ===");

      // First request: Analyze pattern and derive formula
      console.log("\n--- First request (generate reasoning) ---");
      const firstResponse = await client.responses.create({
        model: "gpt-5-codex",
        reasoning: {
          effort: "high",
          summary: "detailed",
        },
        input: [
          {
            role: "user",
            content:
              "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
          },
        ],
      });

      console.log("First response:");
      console.log(firstResponse.output);

      // Second request: Apply the discovered pattern to solve a new problem
      console.log("\n--- Follow-up request (using reasoning context) ---");
      const followUpResponse = await client.responses.create({
        model: "gpt-5-codex",
        reasoning: {
          effort: "high",
          summary: "detailed",
        },
        input: [
          {
            role: "user",
            content:
              "Look at this sequence: 2, 6, 12, 20, 30. What is the pattern and what would be the formula for the nth term?",
          },
          ...firstResponse.output,
          {
            role: "user",
            content:
              "Using the pattern you discovered, what would be the 10th term? And can you find the sum of the first 10 terms?",
          },
        ],
      });

      console.log("Follow-up response:");
      console.log(followUpResponse.output);

      return { firstResponse, followUpResponse };
    },
    { name: "test_reasoning" },
  );
}

// Test 17: Embeddings
async function testEmbeddings() {
  return traced(
    async () => {
      console.log("\n=== Test 19: Embeddings ===");

      // Single embedding
      const response = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: "The quick brown fox jumps over the lazy dog",
      });

      console.log(
        `Embedding dimensions: ${response.data[0]?.embedding.length}`,
      );
      console.log(`First 5 values: ${response.data[0]?.embedding.slice(0, 5)}`);
      console.log(`Tokens used: ${response.usage.total_tokens}`);

      // Batch embeddings
      const batchResponse = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: [
          "Document one content",
          "Document two content",
          "Document three content",
        ],
      });

      console.log(`\nBatch embeddings created: ${batchResponse.data.length}`);
      batchResponse.data.forEach((item, i) => {
        console.log(`Embedding ${i}: ${item.embedding.length} dimensions`);
      });

      return response;
    },
    { name: "test_embeddings" },
  );
}

// Test 18: Response format (JSON schema)
async function testResponseFormat() {
  return traced(
    async () => {
      console.log("\n=== Test 20: Response Format (JSON Schema) ===");

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: "You extract structured information from user queries.",
          },
          {
            role: "user",
            content:
              "Alice is 30 years old and lives in New York. She works as a software engineer.",
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "person_info",
            strict: true,
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
                city: { type: "string" },
                occupation: { type: "string" },
              },
              required: ["name", "age", "city", "occupation"],
              additionalProperties: false,
            },
          },
        },
      });

      console.log("Structured JSON response:");
      console.log(response.choices[0].message.content);

      // Parse and validate
      const parsed = JSON.parse(response.choices[0].message.content!);
      console.log("\nParsed object:");
      console.log(`Name: ${parsed.name}`);
      console.log(`Age: ${parsed.age}`);
      console.log(`City: ${parsed.city}`);
      console.log(`Occupation: ${parsed.occupation}`);

      return response;
    },
    { name: "test_response_format" },
  );
}

// Test 19: Multiple completions (n > 1)
async function testMultipleCompletions() {
  return traced(
    async () => {
      console.log("\n=== Test 21: Multiple Completions ===");

      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 100,
        n: 3,
        messages: [
          {
            role: "user",
            content: "Tell me a one-sentence joke about programming.",
          },
        ],
      });

      console.log(`Generated ${response.choices.length} completions:\n`);
      response.choices.forEach((choice, i) => {
        console.log(`Completion ${i + 1}:`);
        console.log(choice.message.content);
        console.log(`Finish reason: ${choice.finish_reason}\n`);
      });

      console.log(`Total tokens used: ${response.usage?.total_tokens}`);

      return response;
    },
    { name: "test_multiple_completions" },
  );
}

// Test 20: Error handling
async function testErrorHandling() {
  return traced(
    async () => {
      console.log("\n=== Test 22: Error Handling ===");

      // Test 1: Invalid image URL (404)
      await traced(
        async () => {
          console.log("\n--- Test 1: Invalid Image URL ---");
          try {
            await client.chat.completions.create({
              model: "gpt-4o",
              max_tokens: 100,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: {
                        url: "https://example.com/nonexistent-image-404.jpg",
                      },
                    },
                    { type: "text", text: "What's in this image?" },
                  ],
                },
              ],
            });
            throw new Error("Should have thrown an error");
          } catch (error) {
            if (error instanceof OpenAI.APIError) {
              console.log("Caught image URL error:");
              console.log(`  Status: ${error.status}`);
              console.log(`  Message: ${error.message}`);
            } else {
              throw error;
            }
          }
        },
        { name: "test_error_invalid_image_url" },
      );

      // Test 2: Tool choice for non-existent function
      await traced(
        async () => {
          console.log(
            "\n--- Test 2: Tool Choice for Non-Existent Function ---",
          );
          try {
            await client.chat.completions.create({
              model: "gpt-4o",
              max_tokens: 100,
              messages: [
                { role: "user", content: "What's the weather in Paris?" },
              ],
              tools: [
                {
                  type: "function",
                  function: {
                    name: "get_weather",
                    description: "Get weather for a location",
                    parameters: {
                      type: "object",
                      properties: {
                        location: { type: "string" },
                      },
                      required: ["location"],
                    },
                  },
                },
              ],
              tool_choice: {
                type: "function",
                function: { name: "non_existent_function" },
              },
            });
            throw new Error("Should have thrown an error");
          } catch (error) {
            if (error instanceof OpenAI.APIError) {
              console.log("Caught tool choice error:");
              console.log(`  Status: ${error.status}`);
              console.log(`  Message: ${error.message}`);
            } else {
              throw error;
            }
          }
        },
        { name: "test_error_nonexistent_tool" },
      );

      // Test 3: Tool call ID mismatch
      await traced(
        async () => {
          console.log("\n--- Test 3: Tool Call ID Mismatch ---");
          try {
            await client.chat.completions.create({
              model: "gpt-4o",
              max_tokens: 100,
              messages: [
                { role: "user", content: "Calculate 5 + 3" },
                {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_abc123",
                      type: "function",
                      function: {
                        name: "calculate",
                        arguments: '{"a": 5, "b": 3, "operation": "add"}',
                      },
                    },
                  ],
                },
                {
                  role: "tool",
                  tool_call_id: "call_wrong_id",
                  content: "8",
                },
              ],
            });
            throw new Error("Should have thrown an error");
          } catch (error) {
            if (error instanceof OpenAI.APIError) {
              console.log("Caught tool call ID mismatch error:");
              console.log(`  Status: ${error.status}`);
              console.log(`  Message: ${error.message}`);
            } else {
              throw error;
            }
          }
        },
        { name: "test_error_tool_call_id_mismatch" },
      );

      // Test 4: Corrupted base64 image data
      await traced(
        async () => {
          console.log("\n--- Test 4: Corrupted Base64 Image ---");
          try {
            await client.chat.completions.create({
              model: "gpt-4o",
              max_tokens: 100,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: {
                        url: "data:image/png;base64,INVALID_BASE64_DATA!!!",
                      },
                    },
                    { type: "text", text: "What's in this image?" },
                  ],
                },
              ],
            });
            throw new Error("Should have thrown an error");
          } catch (error) {
            if (error instanceof OpenAI.APIError) {
              console.log("Caught corrupted image error:");
              console.log(`  Status: ${error.status}`);
              console.log(`  Message: ${error.message}`);
            } else {
              throw error;
            }
          }
        },
        { name: "test_error_corrupted_base64_image" },
      );

      // Test 5: Invalid JSON schema in response_format
      await traced(
        async () => {
          console.log("\n--- Test 5: Invalid JSON Schema ---");
          try {
            await client.chat.completions.create({
              model: "gpt-4o",
              max_tokens: 100,
              messages: [{ role: "user", content: "Generate a user profile" }],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "invalid_schema",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      name: { type: "invalid_type" },
                    },
                    required: ["nonexistent_field"],
                  },
                },
              },
            });
            throw new Error("Should have thrown an error");
          } catch (error) {
            if (error instanceof OpenAI.APIError) {
              console.log("Caught invalid schema error:");
              console.log(`  Status: ${error.status}`);
              console.log(`  Message: ${error.message}`);
            } else {
              throw error;
            }
          }
        },
        { name: "test_error_invalid_json_schema" },
      );

      console.log("\nError handling tests completed");
    },
    { name: "test_error_handling" },
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

      const response = await client.chat.completions.parse({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: "Generate a simple recipe for chocolate chip cookies.",
          },
        ],
        response_format: zodResponseFormat(recipeSchema, "recipe"),
      });

      const recipe = response.choices[0].message.parsed;
      console.log("Parsed recipe:");
      console.log(`Name: ${recipe?.name}`);
      console.log(`Ingredients: ${recipe?.ingredients?.length}`);
      console.log(`Steps: ${recipe?.steps?.length}`);

      return response;
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

      const stream = client.beta.chat.completions.stream({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content:
              "Generate a product description for a wireless bluetooth headphone.",
          },
        ],
        response_format: zodResponseFormat(productSchema, "product"),
      });

      await stream.done();
    },
    { name: "test_streaming_structured_output" },
  );
}

// Test 23: Structured output with context (multi-turn equivalent)
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

      // Simulate the tool results that would be gathered in AI SDK's multi-turn
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
          comments: ["Great camera!", "Battery lasts all day", "A bit pricey"],
        },
        "laptop-456": {
          rating: 4.2,
          comments: ["Fast performance", "Good display", "Heavy to carry"],
        },
      };

      const response = await client.chat.completions.parse({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful shopping assistant. Use the provided product information to make recommendations.",
          },
          {
            role: "user",
            content: `Compare phone-123 and laptop-456. Here is the product info and reviews:

Product Info:
- phone-123: ${JSON.stringify(productInfo["phone-123"])}
- laptop-456: ${JSON.stringify(productInfo["laptop-456"])}

Reviews:
- phone-123: ${JSON.stringify(reviews["phone-123"])}
- laptop-456: ${JSON.stringify(reviews["laptop-456"])}

Give me a structured comparison with your recommendation.`,
          },
        ],
        response_format: zodResponseFormat(comparisonSchema, "comparison"),
      });

      const comparison = response.choices[0].message.parsed;
      console.log("Product comparison:");
      console.log(`Recommendation: ${comparison?.recommendation}`);
      console.log(`Reasoning: ${comparison?.reasoning}`);
      console.log(`Cheaper: ${comparison?.priceComparison?.cheaper}`);
      console.log(
        `Price difference: $${comparison?.priceComparison?.priceDifference}`,
      );
      console.log(`Phone rating: ${comparison?.overallRating?.phone}`);
      console.log(`Laptop rating: ${comparison?.overallRating?.laptop}`);

      return response;
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
    testReasoning,
    testEmbeddings,
    testResponseFormat,
    testMultipleCompletions,
    testErrorHandling,
    testStructuredOutput,
    testStreamingStructuredOutput,
    testStructuredOutputWithContext,
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
