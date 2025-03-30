import { describe, test } from "vitest";
import { Prompt } from "./logger";
import { PromptData } from "@braintrust/core/typespecs";

describe("prompt strict mode", () => {
  test("strict mode", () => {
    for (const strict of [true, false]) {
      for (const shouldFail of [true, false]) {
        for (const testNull of [true, false]) {
          testPromptBuild({
            promptData: {
              options: {
                model: "gpt-4o",
              },
              prompt: {
                type: "chat",
                messages: [{ role: "user", content: "{{variable}}" }],
              },
            },
            args: shouldFail
              ? {}
              : testNull
                ? { variable: null }
                : {
                    variable: "test",
                  },
            shouldFail,
            strict,
          });

          testPromptBuild({
            promptData: {
              options: {
                model: "gpt-4o",
              },
              prompt: {
                type: "chat",
                messages: [{ role: "user", content: "What is 1+1" }],
                tools: JSON.stringify([
                  {
                    type: "function",
                    function: {
                      name: "{{variable}}",
                      description: "Add two numbers",
                      parameters: {
                        type: "object",
                        properties: {
                          a: { type: "number" },
                          b: { type: "number" },
                        },
                        required: ["a", "b"],
                      },
                    },
                  },
                ]),
              },
            },
            args: shouldFail
              ? {}
              : testNull
                ? { variable: null }
                : {
                    variable: "test",
                  },
            shouldFail,
            strict,
          });

          testPromptBuild({
            promptData: {
              options: {
                model: "gpt-4o",
              },
              prompt: {
                type: "completion",
                content: "{{variable}}",
              },
            },
            args: shouldFail
              ? {}
              : testNull
                ? { variable: null }
                : {
                    variable: "test",
                  },
            shouldFail,
            strict,
          });
        }
      }
    }
  });
});

function testPromptBuild({
  promptData,
  args,
  shouldFail,
  strict,
}: {
  promptData: PromptData;
  args: Record<string, unknown>;
  shouldFail: boolean;
  strict: boolean;
}) {
  const prompt = new Prompt(
    {
      id: "1",
      _xact_id: "xact_123",
      created: "2023-10-01T00:00:00Z",
      project_id: "project_123",
      prompt_session_id: "session_123",
      name: "test",
      slug: "test",
      prompt_data: promptData,
    },
    {},
    true,
  );

  try {
    prompt.build(args, { flavor: promptData.prompt?.type, strict });
  } catch (e) {
    if (!strict || !shouldFail) {
      throw e;
    }
    return;
  }

  if (shouldFail && strict) {
    throw new Error("Expected prompt to fail");
  }
}
