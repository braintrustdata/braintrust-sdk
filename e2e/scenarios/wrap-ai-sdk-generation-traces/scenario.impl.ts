import { initLogger, startSpan, withCurrent, wrapAISDK } from "braintrust";
import { z } from "zod";
import { getTestRunId, scopedName } from "../../helpers/scenario-runtime";

interface WrapAISDKGenerationOptions {
  agentClassExport?: "Experimental_Agent" | "ToolLoopAgent";
  ai: any;
  maxTokensKey: "maxOutputTokens" | "maxTokens";
  openai: (model: string) => unknown;
  sdkVersion: string;
  supportsGenerateObject: boolean;
  supportsStreamObject: boolean;
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

async function runOperation(
  name: string,
  operation: string,
  testRunId: string,
  callback: () => Promise<void>,
): Promise<void> {
  const span = startSpan({
    name,
    event: {
      metadata: {
        operation,
        testRunId,
      },
    },
  });

  await withCurrent(span, callback);
  span.end();
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
      await runOperation(
        "ai-sdk-generate-operation",
        "generate",
        testRunId,
        async () => {
          await wrappedAI.generateText({
            model: openaiModel,
            prompt: "Reply with the single token PARIS and no punctuation.",
            temperature: 0,
            ...tokenLimit(options.maxTokensKey, 16),
          });
        },
      );

      await runOperation(
        "ai-sdk-stream-operation",
        "stream",
        testRunId,
        async () => {
          const result = await wrappedAI.streamText({
            model: openaiModel,
            prompt: "Count from 1 to 3 and include the words one two three.",
            temperature: 0,
            ...tokenLimit(options.maxTokensKey, 32),
          });
          for await (const _chunk of result.textStream) {
          }
        },
      );

      await runOperation(
        "ai-sdk-tool-operation",
        "tool",
        testRunId,
        async () => {
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
        },
      );

      if (options.supportsGenerateObject) {
        await runOperation(
          "ai-sdk-generate-object-operation",
          "generate-object",
          testRunId,
          async () => {
            await wrappedAI.generateObject({
              model: openaiModel,
              prompt: 'Return JSON with {"city":"Paris"}.',
              schema: z.object({
                city: z.string(),
              }),
              temperature: 0,
              ...tokenLimit(options.maxTokensKey, 32),
            });
          },
        );
      }

      if (options.supportsStreamObject) {
        await runOperation(
          "ai-sdk-stream-object-operation",
          "stream-object",
          testRunId,
          async () => {
            const result = await wrappedAI.streamObject({
              model: openaiModel,
              prompt: 'Stream JSON with {"city":"Paris"}.',
              schema: z.object({
                city: z.string(),
              }),
              temperature: 0,
              ...tokenLimit(options.maxTokensKey, 32),
            });
            for await (const _partial of result.partialObjectStream) {
            }
            await result.object;
          },
        );
      }

      if (options.agentClassExport) {
        await runOperation(
          "ai-sdk-agent-generate-operation",
          "agent-generate",
          testRunId,
          async () => {
            const AgentClass = wrappedAI[options.agentClassExport];
            const agent = new AgentClass({
              model: openaiModel,
              system: "You are a terse assistant.",
            });
            await agent.generate({
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly HELLO.",
                },
              ],
              ...tokenLimit(options.maxTokensKey, 16),
            });
          },
        );

        await runOperation(
          "ai-sdk-agent-stream-operation",
          "agent-stream",
          testRunId,
          async () => {
            const AgentClass = wrappedAI[options.agentClassExport];
            const agent = new AgentClass({
              model: openaiModel,
              system: "You are a terse assistant.",
            });
            const result = await agent.stream({
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly STREAM HELLO.",
                },
              ],
              ...tokenLimit(options.maxTokensKey, 16),
            });
            for await (const _chunk of result.textStream) {
            }
          },
        );
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
