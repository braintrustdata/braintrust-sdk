import { initLogger, startSpan, withCurrent, wrapAISDK } from "braintrust";
import { z } from "zod";
import { getTestRunId, scopedName } from "../../helpers/scenario-runtime";

interface WrapAISDKGenerationOptions {
  ai: any;
  maxTokensKey: "maxOutputTokens" | "maxTokens";
  openai: (model: string) => unknown;
  sdkVersion: string;
  supportsGenerateObject: boolean;
  supportsToolExecution: boolean;
  toolSchemaKey: "inputSchema" | "parameters";
}

function tokenLimit(
  key: WrapAISDKGenerationOptions["maxTokensKey"],
  value: number,
): Record<string, number> {
  return { [key]: value };
}

function createWeatherTool(
  ai: any,
  schemaKey: WrapAISDKGenerationOptions["toolSchemaKey"],
) {
  return ai.tool({
    description: "Get the weather for a location",
    [schemaKey]: z.object({
      location: z.string().describe("The city and country"),
    }),
    execute: async (args: { location: string }) =>
      JSON.stringify({
        condition: "sunny",
        location: args.location,
        temperatureC: 22,
      }),
  });
}

export async function runWrapAISDKGenerationTraces(
  options: WrapAISDKGenerationOptions,
) {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-ai-sdk", testRunId),
  });
  const wrappedAI = wrapAISDK(options.ai);
  const openaiModel = options.openai("gpt-4o-mini");

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
          model: openaiModel,
          prompt: "Reply with the single token PARIS and no punctuation.",
          temperature: 0,
          ...tokenLimit(options.maxTokensKey, 16),
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
          model: openaiModel,
          prompt: "Count from 1 to 3 and include the words one two three.",
          temperature: 0,
          ...tokenLimit(options.maxTokensKey, 32),
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
        const toolRequest: Record<string, unknown> = {
          model: openaiModel,
          prompt:
            "Use the get_weather tool for Paris, France. If you do not call the tool, the answer is invalid.",
          system:
            "You must inspect live weather via the provided get_weather tool before responding.",
          temperature: 0,
          tools: {
            get_weather: createWeatherTool(options.ai, options.toolSchemaKey),
          },
          ...tokenLimit(options.maxTokensKey, 128),
        };

        if (options.supportsToolExecution) {
          toolRequest.toolChoice = "required";
          toolRequest.stopWhen = options.ai.stepCountIs(4);
        }

        await wrappedAI.generateText(toolRequest);
      });
      toolSpan.end();

      if (options.supportsGenerateObject) {
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
            model: openaiModel,
            prompt: 'Return JSON with {"city":"Paris"}.',
            schema: z.object({
              city: z.string(),
            }),
            temperature: 0,
          });
        });
        generateObjectSpan.end();
      }
    },
    {
      name: "ai-sdk-wrapper-root",
      event: {
        metadata: {
          aiSdkVersion: options.sdkVersion,
          scenario: "wrap-ai-sdk-generation-traces",
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}
