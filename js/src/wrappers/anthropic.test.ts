import { test, expect, describe, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "./anthropic";
import {
  TextBlock,
  Message,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { initLogger, _exportsForTestingOnly } from "../logger";
import { configureNode } from "../node";
import { getCurrentUnixTimestamp } from "../util";

// use the cheapest model for tests
const TEST_MODEL = "claude-3-haiku-20240307";

try {
  configureNode();
} catch (e) {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

test("anthropic is installed", () => {
  expect(Anthropic).toBeDefined();
});

describe("anthropic client unit tests", () => {
  let anthropic: Anthropic;
  let client: any;
  let backgroundLogger: any;
  let logger: any;

  beforeEach(() => {
    anthropic = new Anthropic();
    client = wrapAnthropic(anthropic);
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const metadata = {
      org_id: "test-org-id",
      project: {
        id: "test-id",
        name: "test-name",
        fullInfo: {},
      },
    };
    logger = initLogger({
      projectName: "anthropic.test.ts",
      orgProjectMetadata: metadata,
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("test client.messages.create works with system text blocks", async (context) => {
    expect(await backgroundLogger.pop()).toHaveLength(0);

    const system: TextBlockParam[] = [
      { text: "translate to english", type: "text" },
      { text: "remove all punctuation", type: "text" },
      { text: "only the answer, no other text", type: "text" },
    ];
    const response = await client.messages.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "Bonjour mon ami!" }],
      max_tokens: 20,
      system: system,
      temperature: 0.01,
    });
    expect(response).toBeDefined();

    const spans = await backgroundLogger.pop();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;
    expect(span["span_attributes"].name).toBe("anthropic.messages.create");
    expect(span.input).toBeDefined();
    const inputsByRole: Record<string, any> = {};
    for (const msg of span.input) {
      inputsByRole[msg["role"]] = msg;
    }
    const userInput = inputsByRole["user"];
    expect(userInput).toBeDefined();
    const systemInput = inputsByRole["system"];
    expect(systemInput.role).toEqual("system");
    expect(systemInput.content).toEqual(system);
  });

  test("test client.messages.stream", async (context) => {
    expect(await backgroundLogger.pop()).toHaveLength(0);

    const stream = client.messages.stream({
      messages: [{ role: "user", content: "tell me about old pond haiku" }],
      system: "no punctuation",
      model: TEST_MODEL,
      max_tokens: 200,
      temperature: 0.01,
    });

    for await (const event of stream) {
    }
    const message = await stream.finalMessage();

    expect(message.content[0].type).toBe("text");
    const content = message.content[0] as TextBlock;
    expect(content.text).toContain("old pond");

    const spans = await backgroundLogger.pop();

    expect(spans).toHaveLength(1);
    const span = spans[0] as any;
    expect(span["span_attributes"].name).toBe("anthropic.messages.create");
    const metrics = span.metrics;
    expect(metrics).toBeDefined();
    expect(metrics.start).toBeDefined();
    expect(metrics.end).toBeDefined();
    expect(metrics.time_to_first_token).toBeDefined();
    expect(metrics.prompt_tokens).toBeGreaterThan(0);
    expect(metrics.completion_tokens).toBeGreaterThan(0);
    expect(metrics.tokens).toBeDefined();
  });

  // TODO[matt]
  test("test with tools", async (context) => {
    // TODO[matt]
    context.skip();
  });

  test("test client.message.create with stream=true", async () => {
    const startTime = getCurrentUnixTimestamp();
    const response = await client.messages.create({
      model: TEST_MODEL,
      messages: [
        {
          role: "user",
          content: "What is Shakespeare's sonnet 18?",
        },
      ],
      max_tokens: 1000,
      system:
        "No punctuation, newlines or non-alphanumeric characters. Just the poem.",
      temperature: 0.01,
      stream: true,
    });

    let ttft = 0;
    for await (const event of response) {
      if (ttft === 0) {
        ttft = getCurrentUnixTimestamp() - startTime;
      }
    }

    const endTime = getCurrentUnixTimestamp();

    // check that the background logger got the log
    const spans = await backgroundLogger.pop();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;
    expect(span.input).toBeDefined();

    // clean up the output to make it easier to spot check
    const output = span.output
      .toLowerCase()
      .replace(/\n/g, " ")
      .replace(/'/g, "");
    // Validate we collected all the text, so check the first, line, the last line
    // and a few others too.
    expect(output).toContain("shall i compare thee to a summers day");
    expect(output).toContain("too hot the eye of heaven shines");
    expect(output).toContain("so long as men can breathe or eyes can see");
    expect(output).toContain("so long lives this and this gives life to thee");

    expect(span["span_attributes"].type).toBe("llm");
    expect(span["span_attributes"].name).toBe("anthropic.messages.create");
    const metrics = span.metrics;
    expect(metrics).toBeDefined();

    const pt = metrics["prompt_tokens"];
    const ct = metrics["completion_tokens"];
    const t = metrics["tokens"];

    expect(pt).toBeGreaterThan(0);
    expect(ct).toBeGreaterThan(0);
    expect(t).toEqual(pt + ct);
    expect(startTime <= metrics.start).toBe(true);
    expect(metrics.start < metrics.end).toBe(true);
    expect(metrics.end <= endTime).toBe(true);
    expect(ttft).toBeGreaterThanOrEqual(metrics.time_to_first_token);
  });

  test("test client.messages.create basics", async () => {
    const startTime = getCurrentUnixTimestamp();
    const response: Message = await client.messages.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "What's 4*4?" }],
      max_tokens: 100,
      system: "Return the result only.",
      temperature: 0.5,
    });
    expect(response).toBeDefined();

    const endTime = getCurrentUnixTimestamp();

    expect(response.content[0].type).toBe("text");
    const content = response.content[0] as TextBlock;
    expect(content.text).toContain("16");

    // check that the background logger got the log
    const spans = await backgroundLogger.pop();
    expect(spans).toHaveLength(1);
    const span = spans[0] as any;
    expect(span["span_attributes"].type).toBe("llm");
    expect(span["span_attributes"].name).toBe("anthropic.messages.create");
    const metadata = span.metadata;
    expect(metadata?.model).toBe(TEST_MODEL);
    expect(metadata?.max_tokens).toBe(100);
    expect(metadata["stop_reason"]).toBe("end_turn");
    expect(metadata["temperature"]).toBe(0.5);
    expect(span?.input).toBeDefined();
    expect(span?.output).toBeDefined();
    const output = span.output[0].text;
    expect(output).toContain("16");
    const metrics = span.metrics;
    const usage = response.usage;
    const ccit = "cache_creation_input_tokens";
    const crit = "cache_read_input_tokens";
    expect(metrics).toBeDefined();
    expect(metrics["prompt_tokens"]).toBe(usage.input_tokens);
    expect(metrics["completion_tokens"]).toBe(usage.output_tokens);
    expect(metrics["tokens"]).toBe(usage.input_tokens + usage.output_tokens);
    expect(metrics[crit]).toBe(usage[crit]);
    expect(metrics[ccit]).toBe(usage[ccit]);
    expect(startTime <= metrics.start).toBe(true);
    expect(metrics.start < metrics.end).toBe(true);
    expect(metrics.end <= endTime).toBe(true);
  });
});
