import { test, assert, beforeEach, afterEach, describe, expect } from "vitest";
import { configureNode } from "../node";
import OpenAI from "openai";
import { _exportsForTestingOnly, initLogger } from "../logger";
import { wrapOpenAI } from "../exports-node";

// use the cheapest model for tests
const TEST_MODEL = "gpt-4o-mini";

try {
  configureNode();
} catch (e) {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

test("openai is installed", () => {
  assert.ok(OpenAI);
});

describe("openai client unit tests", () => {
  let client: OpenAI;
  let backgroundLogger: any;
  let logger: any;

  // fake login before we test. once is enough.
  _exportsForTestingOnly.simulateLoginForTests();

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    const oai = new OpenAI();
    client = wrapOpenAI(oai);
    logger = initLogger({
      projectName: "openai.test.ts",
      projectId: "test-project-id",
    });
  });

  test("openai.responses.create works", async (context) => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const response = await client.responses.create({
      model: TEST_MODEL,
      input: "What is the capital of France?",
    });

    assert.ok(response);
    expect(response.output_text).toContain("Paris");

    const spans = await backgroundLogger.drain();
    assert.lengthOf(spans, 1);
    const span = spans[0] as any;
    assert.equal(span.span_attributes.name, "openai.responses.create");
    assert.equal(span.span_attributes.type, "llm");
    assert.equal(span.input, "What is the capital of France?");
    assert.equal(span.metadata.model, TEST_MODEL);
    expect(span.output).toContain("Paris");
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });
});
