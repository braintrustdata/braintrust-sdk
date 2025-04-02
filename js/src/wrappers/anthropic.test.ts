import { test, expect, describe, beforeEach, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "./anthropic";
import { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { initLogger, _exportsForTestingOnly, Logger } from "../logger";
import { configureNode } from "../node";

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
  let client: Anthropic;
  // FIXME[matt] I don't know how to export a type just for testing.
  // Probably not that important.
  let backgroundLogger: any;
  let logger: Logger<false>;

  beforeEach(() => {
    client = wrapAnthropic(new Anthropic());
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

  test("test anthropic client", async () => {
    const response = await client.messages.create({
      model: TEST_MODEL,
      messages: [{ role: "user", content: "What's 4*4?" }],
      max_tokens: 100,
      system: "Return the result only.",
    });

    expect(response).toBeDefined();
    expect(response.content[0].type).toBe("text");
    const content = response.content[0] as TextBlock;
    expect(content.text).toContain("16");

    // check that the background logger got the log
    const logs = await backgroundLogger.pop();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain("16");
  });
});
