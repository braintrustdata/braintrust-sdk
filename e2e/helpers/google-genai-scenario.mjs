import { readFile } from "node:fs/promises";
import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "./provider-runtime.mjs";

const GOOGLE_MODEL = "gemini-2.0-flash-001";

export async function runGoogleGenAIScenario(options) {
  const imageBase64 = (await readFile(options.testImageUrl)).toString("base64");
  const sdk = options.decorateSDK
    ? options.decorateSDK(options.sdk)
    : options.sdk;
  const { GoogleGenAI } = sdk;
  const client = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  });

  await runTracedScenario({
    callback: async () => {
      await runOperation("google-generate-operation", "generate", async () => {
        await client.models.generateContent({
          model: GOOGLE_MODEL,
          contents: "Reply with exactly PARIS.",
          config: {
            maxOutputTokens: 16,
            temperature: 0,
          },
        });
      });

      await runOperation(
        "google-attachment-operation",
        "attachment",
        async () => {
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
        },
      );

      await runOperation("google-stream-operation", "stream", async () => {
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

      await runOperation(
        "google-stream-return-operation",
        "stream-return",
        async () => {
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
        },
      );

      await runOperation("google-tool-operation", "tool", async () => {
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
                mode: options.sdk.FunctionCallingConfigMode.ANY,
              },
            },
          },
        });
      });
    },
    metadata: {
      scenario: options.scenarioName,
    },
    projectNameBase: options.projectNameBase,
    rootName: options.rootName,
  });
}
