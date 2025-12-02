import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
  expectTypeOf,
  expect,
} from "vitest";
import { configureNode } from "../../node";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "../../logger";
import { wrapAISDK, omit } from "./ai-sdk";
import { getCurrentUnixTimestamp } from "../../util";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";

const TEST_MODEL = "gpt-4o-mini";
const TEST_SUITE_OPTIONS = { timeout: 30000, retry: 3 };
const FIXTURES_DIR = join(__dirname, "fixtures");

try {
  configureNode();
} catch {}

test("ai sdk is installed", () => {
  assert.ok(ai);
});

describe("ai sdk client unit tests", TEST_SUITE_OPTIONS, () => {
  let wrappedAI: typeof ai;
  let backgroundLogger: TestBackgroundLogger;
  let _logger: Logger<false>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    wrappedAI = wrapAISDK(ai);
    _logger = initLogger({
      projectName: "ai-sdk.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("ai wrapping preserves type", () => {
    const wrapped = wrapAISDK(ai);
    expectTypeOf(wrapped.generateText).toEqualTypeOf<typeof ai.generateText>();
    expectTypeOf(wrapped.streamText).toEqualTypeOf<typeof ai.streamText>();
    expectTypeOf(wrapped.generateObject).toEqualTypeOf<
      typeof ai.generateObject
    >();
    expectTypeOf(wrapped.streamObject).toEqualTypeOf<typeof ai.streamObject>();
  });

  test("ai sdk basic completion", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const model = openai(TEST_MODEL);
    const start = getCurrentUnixTimestamp();

    const result = await wrappedAI.generateText({
      model,
      messages: [
        {
          role: "user",
          content: "What is the capital of France? Answer in one word.",
        },
      ],
      maxOutputTokens: 100,
    });

    const end = getCurrentUnixTimestamp();
    assert.ok(result);
    assert.ok(result.text);
    expect(result.text.toLowerCase()).toContain("paris");

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span).toMatchObject({
      project_id: expect.any(String),
      log_id: expect.any(String),
      created: expect.any(String),
      span_id: expect.any(String),
      root_span_id: expect.any(String),
      span_attributes: {
        type: "llm",
        name: "generateText",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
      input: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "What is the capital of France? Answer in one word.",
          }),
        ]),
      }),
      metrics: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    });

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);

    // Check that output is present and not omitted
    expect(span.output).toBeDefined();
    expect(span.output).not.toBe("<omitted>");
    // Note: response.body is intentionally omitted by DENY_OUTPUT_PATHS configuration
    if (
      span.output &&
      typeof span.output === "object" &&
      span.output.response
    ) {
      expect(span.output.response.body).toBe("<omitted>");
    }
  });

  test("braintrust fingerprint metadata", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const model = openai(TEST_MODEL);

    await wrappedAI.generateText({
      model,
      messages: [
        {
          role: "user",
          content: "Say hello",
        },
      ],
      maxOutputTokens: 10,
    });

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    // Verify braintrust fingerprint metadata
    expect(span.metadata.braintrust).toBeDefined();
    expect(span.metadata.braintrust).toMatchObject({
      integration_name: "ai-sdk",
      sdk_language: "typescript",
    });
  });

  test("ai sdk image input", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const base64Image = readFileSync(
      join(FIXTURES_DIR, "test-image.png"),
      "base64",
    );

    const model = openai(TEST_MODEL);
    const start = getCurrentUnixTimestamp();

    const result = await wrappedAI.generateText({
      model,
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
      maxOutputTokens: 100,
    });

    const end = getCurrentUnixTimestamp();
    assert.ok(result);
    assert.ok(result.text);

    // The image contains blue/teal tones (based on the test-image.png)
    const lowerText = result.text.toLowerCase();
    expect(
      lowerText.includes("blue") ||
        lowerText.includes("teal") ||
        lowerText.includes("turquoise"),
    ).toBe(true);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span).toMatchObject({
      project_id: expect.any(String),
      log_id: expect.any(String),
      created: expect.any(String),
      span_id: expect.any(String),
      root_span_id: expect.any(String),
      span_attributes: {
        type: "llm",
        name: "generateText",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
      input: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
              }),
              expect.objectContaining({
                type: "text",
                text: "What color is this image?",
              }),
            ]),
          }),
        ]),
      }),
      metrics: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    });

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);

    // Verify image content is properly handled as attachment
    const messageContent = span.input.messages[0].content;
    expect(messageContent).toBeInstanceOf(Array);
    const imageContent = messageContent.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.type === "image",
    );
    expect(imageContent).toBeDefined();

    // Check that the image was converted to an attachment
    if (imageContent && imageContent.image) {
      expect(imageContent.image.reference).toMatchObject({
        type: "braintrust_attachment",
        key: expect.any(String),
        content_type: "image/png",
      });
    }
  });

  test("ai sdk document input", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const base64Pdf = readFileSync(
      join(FIXTURES_DIR, "test-document.pdf"),
      "base64",
    );

    const model = openai(TEST_MODEL);
    const start = getCurrentUnixTimestamp();

    const result = await wrappedAI.generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: base64Pdf,
              mediaType: "application/pdf",
              filename: "test-document.pdf",
            },
            { type: "text", text: "What is in this document?" },
          ],
        },
      ],
      maxOutputTokens: 150,
    });

    const end = getCurrentUnixTimestamp();
    assert.ok(result);
    assert.ok(result.text);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span).toMatchObject({
      project_id: expect.any(String),
      log_id: expect.any(String),
      created: expect.any(String),
      span_id: expect.any(String),
      root_span_id: expect.any(String),
      span_attributes: {
        type: "llm",
        name: "generateText",
      },
      metadata: expect.objectContaining({
        model: TEST_MODEL,
      }),
      input: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "file",
              }),
              expect.objectContaining({
                type: "text",
                text: "What is in this document?",
              }),
            ]),
          }),
        ]),
      }),
      metrics: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
    });

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);

    // Verify file content is properly handled as attachment
    const messageContent = span.input.messages[0].content;
    expect(messageContent).toBeInstanceOf(Array);
    const fileContent = messageContent.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.type === "file",
    );
    expect(fileContent).toBeDefined();

    // Check that the file was converted to an attachment reference
    if (fileContent && fileContent.data) {
      expect(fileContent.data.reference).toMatchObject({
        type: "braintrust_attachment",
        key: expect.any(String),
        content_type: "application/pdf",
      });
      // Ensure the raw base64 data is NOT in the input
      expect(typeof fileContent.data).toBe("object");
      expect(fileContent.data).not.toBe(base64Pdf);
    }
  });

  test("ai sdk streaming completion", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const model = openai(TEST_MODEL);
    const start = getCurrentUnixTimestamp();

    const stream = await wrappedAI.streamText({
      model,
      messages: [
        {
          role: "user",
          content: "Count from 1 to 5.",
        },
      ],
      maxOutputTokens: 100,
    });

    let ttft = -1.0;
    let chunkCount = 0;
    let fullText = "";

    for await (const chunk of stream.textStream) {
      if (ttft < 0) {
        ttft = getCurrentUnixTimestamp() - start;
      }
      chunkCount++;
      fullText += chunk;
      assert.ok(chunk !== undefined);
    }

    const end = getCurrentUnixTimestamp();
    expect(chunkCount).toBeGreaterThan(0);
    expect(fullText).toMatch(/1.*2.*3.*4.*5/s);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.span_attributes.name).toBe("streamText");
    expect(span.span_attributes.type).toBe("llm");

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    if (metrics.time_to_first_token !== undefined) {
      expect(ttft).toBeGreaterThanOrEqual(metrics.time_to_first_token);
    }

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);
  });

  test("ai sdk multi-turn conversation", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const model = openai(TEST_MODEL);
    const start = getCurrentUnixTimestamp();

    const result = await wrappedAI.generateText({
      model,
      messages: [
        {
          role: "user",
          content: "Hi, my name is Alice.",
        },
        {
          role: "assistant",
          content: "Hello Alice! Nice to meet you.",
        },
        {
          role: "user",
          content: "What did I just tell you my name was?",
        },
      ],
      maxOutputTokens: 100,
    });

    const end = getCurrentUnixTimestamp();
    assert.ok(result);
    assert.ok(result.text);
    expect(result.text.toLowerCase()).toContain("alice");

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.input.messages).toHaveLength(3);
    expect(span.input.messages[0].role).toBe("user");
    expect(span.input.messages[1].role).toBe("assistant");
    expect(span.input.messages[2].role).toBe("user");

    const { metrics } = span;
    expect(start).toBeLessThanOrEqual(metrics.start);
    expect(metrics.start).toBeLessThanOrEqual(metrics.end);
    expect(metrics.end).toBeLessThanOrEqual(end);

    expect(metrics.tokens).toBeGreaterThan(0);
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);
  });

  test("ai sdk system prompt", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const model = openai(TEST_MODEL);
    const result = await wrappedAI.generateText({
      model,
      system: "You are a pirate. Always respond in pirate speak.",
      messages: [
        {
          role: "user",
          content: "Tell me about the weather.",
        },
      ],
      maxOutputTokens: 150,
    });

    assert.ok(result);
    assert.ok(result.text);

    // Check for pirate-like language
    const lowerText = result.text.toLowerCase();
    const hasPirateSpeak =
      lowerText.includes("arr") ||
      lowerText.includes("ahoy") ||
      lowerText.includes("matey") ||
      lowerText.includes("ye ") ||
      lowerText.includes("aye");

    expect(hasPirateSpeak).toBe(true);

    const spans = await backgroundLogger.drain();
    expect(spans).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const span = spans[0] as any;

    expect(span.input).toMatchObject({
      system: "You are a pirate. Always respond in pirate speak.",
    });
  });

  test("streamObject toTextStreamResponse", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const simpleSchema = z.object({ answer: z.string() });
    const streamRes = await wrappedAI.streamObject({
      model: openai(TEST_MODEL),
      schema: simpleSchema,
      prompt: "Stream a JSON object with key 'answer' set to 'ok'.",
    });

    const response = streamRes.toTextStreamResponse();
    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeTruthy();

    if (response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      const fullText = chunks.join("");
      expect(fullText.length).toBeGreaterThan(0);
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const spans = (await backgroundLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "streamObject" &&
        s?.output &&
        typeof s.output === "object",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(typeof wrapperSpan.metrics?.time_to_first_token).toBe("number");
  });

  test("streamText returns correct type with toUIMessageStreamResponse", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const result = wrappedAI.streamText({
      model: openai(TEST_MODEL),
      prompt: "Say hello in one sentence.",
    });

    // Verify result is not a Promise (synchronous return)
    expect(result).not.toBeInstanceOf(Promise);

    // Verify toUIMessageStreamResponse method exists
    expect(typeof result.toUIMessageStreamResponse).toBe("function");

    // Verify it can be called
    const response = result.toUIMessageStreamResponse();
    expect(response).toBeInstanceOf(Response);
    expect(response.body).toBeTruthy();

    // Consume the stream to trigger logging
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    // Wait for the stream to fully finish and onFinish callback to complete
    await result.text;

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const spans = (await backgroundLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "streamText" &&
        s?.output &&
        typeof s.output === "object" &&
        typeof s.output.text === "string",
    );
    expect(wrapperSpan).toBeTruthy();
  });

  test("streamText supports async iteration over textStream", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const result = wrappedAI.streamText({
      model: openai(TEST_MODEL),
      prompt: "Invent a new holiday and describe its traditions.",
    });

    // Verify result is not a Promise (synchronous return)
    expect(result).not.toBeInstanceOf(Promise);

    // Verify textStream property exists
    expect(result.textStream).toBeTruthy();

    // Consume the stream using async iteration
    let fullText = "";
    for await (const textPart of result.textStream) {
      fullText += textPart;
    }

    // Verify we got some text
    expect(fullText.length).toBeGreaterThan(0);

    // Wait for the stream to fully finish and onFinish callback to complete
    await result.text;

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const spans = (await backgroundLogger.drain()) as any[];
    const wrapperSpan = spans.find(
      (s) =>
        s?.span_attributes?.name === "streamText" &&
        s?.output &&
        typeof s.output === "object" &&
        typeof s.output.text === "string",
    );
    expect(wrapperSpan).toBeTruthy();
    expect(wrapperSpan.output.text).toBe(fullText);
  });

  test("omit function respects path specificity", () => {
    // Test that paths only omit specific nested properties
    const testObj = {
      body: "This should NOT be omitted",
      response: {
        body: "This SHOULD be omitted",
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
      request: {
        body: "This SHOULD be omitted",
        method: "POST",
        url: "https://api.example.com",
      },
      text: "Some text content",
      metadata: {
        model: "gpt-4",
      },
    };

    const paths = ["request.body", "response.body"];
    const result = omit(testObj, paths);

    // Root-level body should NOT be omitted
    expect(result.body).toBe("This should NOT be omitted");

    // response.body SHOULD be omitted
    expect(result.response.body).toBe("<omitted>");

    // request.body SHOULD be omitted
    expect(result.request.body).toBe("<omitted>");

    // Other properties should remain unchanged
    expect(result.response.headers).toEqual({
      "content-type": "application/json",
    });
    expect(result.response.status).toBe(200);
    expect(result.request.method).toBe("POST");
    expect(result.request.url).toBe("https://api.example.com");
    expect(result.text).toBe("Some text content");
    expect(result.metadata.model).toBe("gpt-4");
  });

  test("omit function handles non-existent paths", () => {
    const testObj = {
      a: {
        b: "value",
      },
      c: "another value",
    };

    const paths = ["a.b.c.d", "x.y.z", "a.nonexistent"];
    const result = omit(testObj, paths);

    // Non-existent paths should not affect the output
    expect(result).toEqual({
      a: {
        b: "value",
      },
      c: "another value",
    });

    // Test with a fully non-existent deep path
    const testObj2 = {
      a: "value",
    };
    const result2 = omit(testObj2, ["b.c.d"]);
    expect(result2).toEqual({
      a: "value",
    });
  });

  test("omit function handles partial paths correctly", () => {
    // Test that paths are only omitted when they fully exist
    const testObj = {
      request: {
        method: "POST",
        url: "https://api.example.com",
        // Note: no 'body' property
      },
      response: {
        status: 200,
        body: {
          data: "some data",
        },
      },
      metadata: {
        model: "gpt-4",
      },
    };

    const paths = ["request.body", "response.body"];
    const result = omit(testObj, paths);

    // request.body doesn't exist, so request should be unchanged
    expect(result.request).toEqual({
      method: "POST",
      url: "https://api.example.com",
    });

    // response.body exists and should be omitted
    expect(result.response.body).toBe("<omitted>");
    expect(result.response.status).toBe(200);

    // Other properties should remain unchanged
    expect(result.metadata).toEqual({
      model: "gpt-4",
    });
  });

  test("omit function handles root-level primitives", () => {
    const obj = { a: { b: 2 }, c: 3, d: 4 };
    const result = omit(obj, ["a.b", "c"]);

    expect(result).toEqual({
      a: { b: "<omitted>" },
      c: "<omitted>",
      d: 4,
    });
  });

  test("omit function handles arrays", () => {
    const testObj = {
      items: [1, 2, 3],
      nested: {
        arr: ["a", "b", "c"],
      },
    };

    const result = omit(testObj, ["items", "nested.arr"]);

    expect(result.items).toBe("<omitted>");
    expect(result.nested.arr).toBe("<omitted>");
  });

  test("omit function handles empty paths array", () => {
    const testObj = { a: 1, b: 2 };
    const result = omit(testObj, []);

    expect(result).toEqual({ a: 1, b: 2 });
  });

  test("omit function handles single-key paths", () => {
    const testObj = {
      key1: "value1",
      key2: { nested: "value2" },
      key3: "value3",
    };

    const result = omit(testObj, ["key1", "key3"]);

    expect(result.key1).toBe("<omitted>");
    expect(result.key2).toEqual({ nested: "value2" });
    expect(result.key3).toBe("<omitted>");
  });

  test("omit function handles mixed primitives and objects", () => {
    const testObj = {
      string: "text",
      number: 42,
      boolean: true,
      nullValue: null,
      obj: { nested: "value" },
      arr: [1, 2, 3],
    };

    const result = omit(testObj, [
      "string",
      "number",
      "boolean",
      "nullValue",
      "obj.nested",
    ]);

    expect(result.string).toBe("<omitted>");
    expect(result.number).toBe("<omitted>");
    expect(result.boolean).toBe("<omitted>");
    expect(result.nullValue).toBe("<omitted>");
    expect(result.obj.nested).toBe("<omitted>");
    expect(result.arr).toEqual([1, 2, 3]);
  });

  test("omit function handles array wildcards", () => {
    const testObj = {
      a: [{ b: 1 }, { b: 2 }, { b: 3 }],
    };

    const result = omit(testObj, ["a[].b"]);

    expect(result.a).toEqual([
      { b: "<omitted>" },
      { b: "<omitted>" },
      { b: "<omitted>" },
    ]);
  });

  test("omit function handles array indices", () => {
    const testObj = {
      a: [{ b: 1 }, { b: 2 }, { b: 3 }],
    };

    const result = omit(testObj, ["a[0].b", "a[2].b"]);

    expect(result.a).toEqual([
      { b: "<omitted>" },
      { b: 2 },
      { b: "<omitted>" },
    ]);
  });

  test("omit function handles mixed bracket and dot notation", () => {
    const testObj = {
      users: [
        { name: "Alice", settings: { theme: "dark" } },
        { name: "Bob", settings: { theme: "light" } },
      ],
    };

    const result = omit(testObj, ["users[].settings.theme"]);

    expect(result.users).toEqual([
      { name: "Alice", settings: { theme: "<omitted>" } },
      { name: "Bob", settings: { theme: "<omitted>" } },
    ]);
  });

  test("omit function handles nested array wildcards", () => {
    const testObj = {
      data: [
        { items: [{ value: 1 }, { value: 2 }] },
        { items: [{ value: 3 }, { value: 4 }] },
      ],
    };

    const result = omit(testObj, ["data[].items[].value"]);

    expect(result.data).toEqual([
      { items: [{ value: "<omitted>" }, { value: "<omitted>" }] },
      { items: [{ value: "<omitted>" }, { value: "<omitted>" }] },
    ]);
  });

  test("ai sdk tool execution with input/output", async () => {
    expect(await backgroundLogger.drain()).toHaveLength(0);

    const calculateTool = ai.tool({
      description: "Perform a mathematical calculation",
      inputSchema: z.object({
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      }),
      execute: async (args: {
        operation: "add" | "subtract" | "multiply" | "divide";
        a: number;
        b: number;
      }) => {
        switch (args.operation) {
          case "add":
            return String(args.a + args.b);
          case "subtract":
            return String(args.a - args.b);
          case "multiply":
            return String(args.a * args.b);
          case "divide":
            return args.b !== 0 ? String(args.a / args.b) : "0";
          default:
            return "0";
        }
      },
    });

    const model = openai(TEST_MODEL);

    const result = await wrappedAI.generateText({
      model,
      tools: {
        calculate: calculateTool,
      },
      prompt: "What is 25 plus 17? Use the calculate tool.",
      stopWhen: ai.stepCountIs(2),
    });

    assert.ok(result);
    // Note: result.text may be empty if only tool calls were made without follow-up

    const spans = await backgroundLogger.drain();

    // Should have at least 2 spans: the main generateText span and the tool execution span
    expect(spans.length).toBeGreaterThanOrEqual(2);

    // Find the tool execution span
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const toolSpan = spans.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (span: any) =>
        span.span_attributes?.type === "tool" &&
        span.span_attributes?.name === "calculate",
    );

    expect(toolSpan).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const toolSpanTyped = toolSpan as any;

    // Verify the tool span has the correct structure
    expect(toolSpanTyped).toMatchObject({
      span_attributes: {
        type: "tool",
        name: "calculate",
      },
    });

    // Verify input is captured
    expect(toolSpanTyped.input).toBeDefined();
    // Input can be an array if multiple args are passed, check the first element
    const inputData = Array.isArray(toolSpanTyped.input)
      ? toolSpanTyped.input[0]
      : toolSpanTyped.input;
    expect(inputData).toMatchObject({
      operation: "add",
      a: 25,
      b: 17,
    });

    // Verify output is captured
    expect(toolSpanTyped.output).toBeDefined();
    expect(toolSpanTyped.output).toBe("42");
  });
});
