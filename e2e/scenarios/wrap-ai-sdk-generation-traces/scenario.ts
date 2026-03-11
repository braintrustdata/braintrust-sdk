import { openai } from "@ai-sdk/openai";
import * as ai from "ai";
import { initLogger, startSpan, withCurrent, wrapAISDK } from "braintrust";
import { z } from "zod";
import {
  getTestRunId,
  runMain,
  scopedName,
} from "../../helpers/scenario-runtime";

const OPENAI_MODEL = openai("gpt-4o-mini");

async function main() {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-ai-sdk", testRunId),
  });
  const wrappedAI = wrapAISDK(ai);

  await logger.traced(
    async () => {
      const generateSpan = startSpan({
        name: "ai-sdk-generate-operation",
        event: {
          metadata: {
            operation: "generate",
            testRunId,
          },
        },
      });
      await withCurrent(generateSpan, async () => {
        await wrappedAI.generateText({
          model: OPENAI_MODEL,
          temperature: 0,
          prompt: "Reply with the single token PARIS and no punctuation.",
          maxOutputTokens: 16,
        });
      });
      generateSpan.end();

      const streamSpan = startSpan({
        name: "ai-sdk-stream-operation",
        event: {
          metadata: {
            operation: "stream",
            testRunId,
          },
        },
      });
      await withCurrent(streamSpan, async () => {
        const result = await wrappedAI.streamText({
          model: OPENAI_MODEL,
          temperature: 0,
          prompt: "Count from 1 to 3 and include the words one two three.",
          maxOutputTokens: 32,
        });
        for await (const _chunk of result.textStream) {
        }
      });
      streamSpan.end();

      const toolSpan = startSpan({
        name: "ai-sdk-tool-operation",
        event: {
          metadata: {
            operation: "tool",
            testRunId,
          },
        },
      });
      await withCurrent(toolSpan, async () => {
        await wrappedAI.generateText({
          model: OPENAI_MODEL,
          temperature: 0,
          system:
            "You must call get_weather once before answering. Do not answer from memory.",
          prompt: "What is the weather in Paris, France?",
          maxOutputTokens: 128,
          toolChoice: "required",
          stopWhen: ai.stepCountIs(4),
          tools: {
            get_weather: ai.tool({
              description: "Get the weather for a location",
              inputSchema: z.object({
                location: z.string().describe("The city and country"),
              }),
              execute: async (args: { location: string }) =>
                JSON.stringify({
                  condition: "sunny",
                  location: args.location,
                  temperatureC: 22,
                }),
            }),
          },
        });
      });
      toolSpan.end();

      const generateObjectSpan = startSpan({
        name: "ai-sdk-generate-object-operation",
        event: {
          metadata: {
            operation: "generate-object",
            testRunId,
          },
        },
      });
      await withCurrent(generateObjectSpan, async () => {
        await wrappedAI.generateObject({
          model: OPENAI_MODEL,
          temperature: 0,
          output: "object",
          schema: z.object({
            city: z.string(),
          }),
          prompt: 'Return JSON with {"city":"Paris"}.',
        });
      });
      generateObjectSpan.end();
    },
    {
      name: "ai-sdk-wrapper-root",
      event: {
        metadata: {
          scenario: "wrap-ai-sdk-generation-traces",
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

runMain(main);
