import {
  expect,
  test,
  describe,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { Middleware } from "./ai-sdk-middleware";
import {
  _exportsForTestingOnly,
  Logger,
  TestBackgroundLogger,
  initLogger,
  _internalSetInitialState,
} from "../logger";

const testModelName = "gpt-4.1";

_exportsForTestingOnly.setInitialTestState();

test("ai sdk middleware is installed", () => {
  expect(wrapLanguageModel).toBeDefined();
  expect(openai).toBeDefined();
});

describe("ai sdk middleware tests", () => {
  let testLogger: TestBackgroundLogger;
  let logger: Logger<true>;
  let rawModel = openai(testModelName);
  let wrappedModel = wrapLanguageModel({
    model: rawModel,
    middleware: Middleware({ debug: true, name: "TestMiddleware" }),
  });
  let models = [rawModel, wrappedModel];

  beforeEach(async () => {
    testLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    logger = initLogger({
      projectName: "anthropic.test.ts",
      projectId: "test-project-id",
    });
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("generateText wrapLanguageModel", async () => {
    for (const [_, model] of models.entries()) {
      const isWrapped = model === wrappedModel;

      console.log(isWrapped ? "wrapped" : "not wrapped");

      const { text } = await generateText({
        model: model,
        prompt: "What is 2+2?",
        system: "Just return the number",
      });
      console.log(text);
    }
  });
});
