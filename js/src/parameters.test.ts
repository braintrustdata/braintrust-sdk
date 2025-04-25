import { expect, test, beforeAll } from "vitest";
import { runEvaluator } from "./framework";
import { z } from "zod";
import { type ProgressReporter } from "./progress";
import { configureNode } from "./node";

beforeAll(() => {
  configureNode();
});

class NoopProgressReporter implements ProgressReporter {
  public start() {}
  public stop() {}
  public increment() {}
}

test("parameters are passed to task", async () => {
  const out = await runEvaluator(
    null,
    {
      projectName: "test-parameters",
      evalName: "test",
      data: [{ input: "hello" }],
      task: async (input: string, { parameters }) => {
        const output = `${parameters.prefix}${input}${parameters.suffix}`;
        return output;
      },
      scores: [],
      parameters: {
        prefix: z.string().default("start:"),
        suffix: z.string().default(":end"),
      },
    },
    new NoopProgressReporter(),
    [],
    undefined,
    { prefix: "start:", suffix: ":end" },
  );

  expect(out.results).toHaveLength(1);
  expect(out.results[0].output).toBe("start:hello:end");
});

test("prompt parameter is passed correctly", async () => {
  const result = await runEvaluator(
    null,
    {
      projectName: "test-prompt-parameter",
      evalName: "test",
      data: [{ input: "test input" }],
      task: async (input: string, { parameters }) => {
        // Verify the prompt parameter has the expected structure
        if (!parameters.main || typeof parameters.main.build !== "function") {
          throw new Error(
            "Prompt parameter 'main' is missing or does not have a build function",
          );
        }
        return input;
      },
      scores: [],
      parameters: {
        main: {
          type: "prompt",
          name: "Main prompt",
          description: "Test prompt",
          default: {
            messages: [
              {
                role: "user",
                content: "{{input}}",
              },
            ],
            model: "gpt-4",
          },
        },
      },
    },
    new NoopProgressReporter(),
    [],
    undefined,
    undefined,
  );

  expect(result.results).toHaveLength(1);
  expect(result.results[0].output).toBe("test input");
});

test("custom parameter values override defaults", async () => {
  const result = await runEvaluator(
    null,
    {
      projectName: "test-custom-parameters",
      evalName: "test",
      data: [{ input: "hello" }],
      task: async (input: string, { parameters }) => {
        const output = `${parameters.prefix}${input}${parameters.suffix}`;
        return output;
      },
      scores: [],
      parameters: {
        prefix: z.string().default("start:"),
        suffix: z.string().default(":end"),
      },
    },
    new NoopProgressReporter(),
    [],
    undefined,
    {
      prefix: "custom:",
      suffix: ":custom",
    },
  );

  expect(result.results).toHaveLength(1);
  expect(result.results[0].output).toBe("custom:hello:custom");
});

test("array parameter is handled correctly", async () => {
  const result = await runEvaluator(
    null,
    {
      projectName: "test-array-parameter",
      evalName: "test",
      data: [{ input: "test" }],
      task: async (input: string, { parameters }) => {
        expect(Array.isArray(parameters.items)).toBe(true);
        expect(parameters.items).toEqual(["item1", "item2"]);
        return input;
      },
      scores: [],
      parameters: {
        items: z.array(z.string()).default(["item1", "item2"]),
      },
    },
    new NoopProgressReporter(),
    [],
    undefined,
    undefined,
  );

  expect(result.results).toHaveLength(1);
  expect(result.results[0].output).toBe("test");
});

test("object parameter is handled correctly", async () => {
  const result = await runEvaluator(
    null,
    {
      projectName: "test-object-parameter",
      evalName: "test",
      data: [{ input: "test" }],
      task: async (input: string, { parameters }) => {
        expect(parameters.config).toEqual({
          name: "test",
          value: 123,
        });
        return input;
      },
      scores: [],
      parameters: {
        config: z
          .object({
            name: z.string(),
            value: z.number(),
          })
          .default({
            name: "test",
            value: 123,
          }),
      },
    },
    new NoopProgressReporter(),
    [],
    undefined,
    undefined,
  );

  expect(result.results).toHaveLength(1);
  expect(result.results[0].output).toBe("test");
});
