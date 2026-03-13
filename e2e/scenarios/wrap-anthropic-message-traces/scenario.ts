import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { initLogger, startSpan, withCurrent, wrapAnthropic } from "braintrust";
import {
  collectAsync,
  getTestRunId,
  runMain,
  scopedName,
} from "../../helpers/scenario-runtime";

const ANTHROPIC_MODEL = "claude-3-haiku-20240307";
const TEST_IMAGE_URL = new URL("./test-image.png", import.meta.url);

async function main() {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-anthropic", testRunId),
  });
  const imageBase64 = (await readFile(TEST_IMAGE_URL)).toString("base64");
  const client = wrapAnthropic(
    new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    }),
  );

  await logger.traced(
    async () => {
      const createSpan = startSpan({
        name: "anthropic-create-operation",
        event: {
          metadata: {
            operation: "create",
            testRunId,
          },
        },
      });
      await withCurrent(createSpan, async () => {
        await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 16,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: "Reply with exactly OK.",
            },
          ],
        });
      });
      createSpan.end();

      const attachmentSpan = startSpan({
        name: "anthropic-attachment-operation",
        event: {
          metadata: {
            operation: "attachment",
            testRunId,
          },
        },
      });
      await withCurrent(attachmentSpan, async () => {
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
      });
      attachmentSpan.end();

      const streamSpan = startSpan({
        name: "anthropic-stream-operation",
        event: {
          metadata: {
            operation: "stream",
            testRunId,
          },
        },
      });
      await withCurrent(streamSpan, async () => {
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
      streamSpan.end();

      const withResponseSpan = startSpan({
        name: "anthropic-stream-with-response-operation",
        event: {
          metadata: {
            operation: "stream-with-response",
            testRunId,
          },
        },
      });
      await withCurrent(withResponseSpan, async () => {
        const stream = client.messages.stream({
          model: ANTHROPIC_MODEL,
          max_tokens: 32,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: "Count from 1 to 3 and include the words one two three.",
            },
          ],
        });
        await collectAsync(stream);
      });
      withResponseSpan.end();

      const toolSpan = startSpan({
        name: "anthropic-tool-operation",
        event: {
          metadata: {
            operation: "tool",
            testRunId,
          },
        },
      });
      await withCurrent(toolSpan, async () => {
        await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 128,
          temperature: 0,
          tools: [
            {
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
            },
          ],
          messages: [
            {
              role: "user",
              content:
                "Use the get_weather tool for Paris, France. Do not answer from memory.",
            },
          ],
        });
      });
      toolSpan.end();

      const betaCreateSpan = startSpan({
        name: "anthropic-beta-create-operation",
        event: {
          metadata: {
            operation: "beta-create",
            testRunId,
          },
        },
      });
      await withCurrent(betaCreateSpan, async () => {
        await client.beta.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 16,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: "Reply with exactly BETA.",
            },
          ],
        });
      });
      betaCreateSpan.end();

      const betaStreamSpan = startSpan({
        name: "anthropic-beta-stream-operation",
        event: {
          metadata: {
            operation: "beta-stream",
            testRunId,
          },
        },
      });
      await withCurrent(betaStreamSpan, async () => {
        const stream = await client.beta.messages.create({
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
      betaStreamSpan.end();
    },
    {
      name: "anthropic-wrapper-root",
      event: {
        metadata: {
          scenario: "wrap-anthropic-message-traces",
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

runMain(main);
