import { readFile } from "node:fs/promises";
import * as googleGenAI from "@google/genai";
import {
  initLogger,
  startSpan,
  withCurrent,
  wrapGoogleGenAI,
} from "braintrust";
import {
  collectAsync,
  getTestRunId,
  runMain,
  scopedName,
} from "../../helpers/scenario-runtime";

const GOOGLE_MODEL = "gemini-2.0-flash-001";
const TEST_IMAGE_URL = new URL("./test-image.png", import.meta.url);

async function main() {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-google-genai", testRunId),
  });
  const imageBase64 = (await readFile(TEST_IMAGE_URL)).toString("base64");
  const { GoogleGenAI } = wrapGoogleGenAI(googleGenAI);
  const client = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  });

  await logger.traced(
    async () => {
      const generateSpan = startSpan({
        name: "google-generate-operation",
        event: {
          metadata: {
            operation: "generate",
            testRunId,
          },
        },
      });
      await withCurrent(generateSpan, async () => {
        await client.models.generateContent({
          model: GOOGLE_MODEL,
          contents: "Reply with exactly PARIS.",
          config: {
            maxOutputTokens: 16,
            temperature: 0,
          },
        });
      });
      generateSpan.end();

      const attachmentSpan = startSpan({
        name: "google-attachment-operation",
        event: {
          metadata: {
            operation: "attachment",
            testRunId,
          },
        },
      });
      await withCurrent(attachmentSpan, async () => {
        await client.models.generateContent({
          model: GOOGLE_MODEL,
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    data: imageBase64,
                    mimeType: "image/png",
                  },
                },
                {
                  text: "Describe the attached image in one short sentence.",
                },
              ],
              role: "user",
            },
          ],
          config: {
            maxOutputTokens: 24,
            temperature: 0,
          },
        });
      });
      attachmentSpan.end();

      const streamSpan = startSpan({
        name: "google-stream-operation",
        event: {
          metadata: {
            operation: "stream",
            testRunId,
          },
        },
      });
      await withCurrent(streamSpan, async () => {
        const stream = await client.models.generateContentStream({
          model: GOOGLE_MODEL,
          contents: "Count from 1 to 3 and include the words one two three.",
          config: {
            maxOutputTokens: 32,
            temperature: 0,
          },
        });
        await collectAsync(stream);
      });
      streamSpan.end();

      const streamReturnSpan = startSpan({
        name: "google-stream-return-operation",
        event: {
          metadata: {
            operation: "stream-return",
            testRunId,
          },
        },
      });
      await withCurrent(streamReturnSpan, async () => {
        const stream = await client.models.generateContentStream({
          model: GOOGLE_MODEL,
          contents: "Write a short poem about Paris.",
          config: {
            maxOutputTokens: 48,
            temperature: 0,
          },
        });

        for await (const _chunk of stream) {
          break;
        }
      });
      streamReturnSpan.end();

      const toolSpan = startSpan({
        name: "google-tool-operation",
        event: {
          metadata: {
            operation: "tool",
            testRunId,
          },
        },
      });
      await withCurrent(toolSpan, async () => {
        await client.models.generateContent({
          model: GOOGLE_MODEL,
          contents:
            "Use the get_weather function for Paris, France. Do not answer from memory.",
          config: {
            maxOutputTokens: 128,
            temperature: 0,
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "get_weather",
                    description: "Get the current weather in a given location",
                    parametersJsonSchema: {
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
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                allowedFunctionNames: ["get_weather"],
                mode: googleGenAI.FunctionCallingConfigMode.ANY,
              },
            },
          },
        });
      });
      toolSpan.end();
    },
    {
      name: "google-genai-wrapper-root",
      event: {
        metadata: {
          scenario: "wrap-google-genai-content-traces",
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}

runMain(main);
