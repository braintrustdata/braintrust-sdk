import { readFile } from "node:fs/promises";
import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "./provider-runtime.mjs";

const ANTHROPIC_MODEL = "claude-3-haiku-20240307";
const WEATHER_TOOL = {
  name: "get_weather",
  description: "Get the current weather in a given location",
  input_schema: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city and state or city and country",
      },
    },
    required: ["location"],
  },
};

export async function runAnthropicScenario(options) {
  const imageBase64 = (await readFile(options.testImageUrl)).toString("base64");
  const baseClient = new options.Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const client = options.decorateClient
    ? options.decorateClient(baseClient)
    : baseClient;

  await runTracedScenario({
    callback: async () => {
      await runOperation("anthropic-create-operation", "create", async () => {
        await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 16,
          temperature: 0,
          messages: [{ role: "user", content: "Reply with exactly OK." }],
        });
      });

      await runOperation(
        "anthropic-attachment-operation",
        "attachment",
        async () => {
          await client.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 32,
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Describe the attached image in one short sentence.",
                  },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: imageBase64,
                    },
                  },
                ],
              },
            ],
          });
        },
      );

      await runOperation("anthropic-stream-operation", "stream", async () => {
        const stream = await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 32,
          temperature: 0,
          stream: true,
          messages: [
            {
              role: "user",
              content: "Count from 1 to 3 and include the words one two three.",
            },
          ],
        });
        await collectAsync(stream);
      });

      await runOperation(
        "anthropic-stream-with-response-operation",
        "stream-with-response",
        async () => {
          const stream =
            options.useMessagesStreamHelper === false
              ? await client.messages.create({
                  model: ANTHROPIC_MODEL,
                  max_tokens: 32,
                  temperature: 0,
                  stream: true,
                  messages: [
                    {
                      role: "user",
                      content:
                        "Count from 1 to 3 and include the words one two three.",
                    },
                  ],
                })
              : client.messages.stream({
                  model: ANTHROPIC_MODEL,
                  max_tokens: 32,
                  temperature: 0,
                  messages: [
                    {
                      role: "user",
                      content:
                        "Count from 1 to 3 and include the words one two three.",
                    },
                  ],
                });
          await collectAsync(stream);
        },
      );

      await runOperation(
        "anthropic-stream-tool-operation",
        "stream-tool",
        async () => {
          const stream = await client.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 128,
            temperature: 0,
            stream: true,
            tool_choice: {
              type: "tool",
              name: WEATHER_TOOL.name,
              disable_parallel_tool_use: true,
            },
            tools: [WEATHER_TOOL],
            messages: [
              {
                role: "user",
                content:
                  "Use the get_weather tool for Paris, France. Do not answer from memory.",
              },
            ],
          });
          await collectAsync(stream);
        },
      );

      await runOperation("anthropic-tool-operation", "tool", async () => {
        await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 128,
          temperature: 0,
          tools: [WEATHER_TOOL],
          messages: [
            {
              role: "user",
              content:
                "Use the get_weather tool for Paris, France. Do not answer from memory.",
            },
          ],
        });
      });

      await runOperation(
        "anthropic-beta-create-operation",
        "beta-create",
        async () => {
          await client.beta.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 16,
            temperature: 0,
            messages: [{ role: "user", content: "Reply with exactly BETA." }],
          });
        },
      );

      await runOperation(
        "anthropic-beta-stream-operation",
        "beta-stream",
        async () => {
          const stream = await client.beta.messages.create({
            model: ANTHROPIC_MODEL,
            max_tokens: 32,
            temperature: 0,
            stream: true,
            messages: [
              {
                role: "user",
                content:
                  "Count from 1 to 3 and include the words one two three.",
              },
            ],
          });
          await collectAsync(stream);
        },
      );
    },
    metadata: {
      scenario: options.scenarioName,
    },
    projectNameBase: options.projectNameBase,
    rootName: options.rootName,
  });
}
