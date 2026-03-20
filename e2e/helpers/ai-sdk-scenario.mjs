import { runTracedScenario, runOperation } from "./provider-runtime.mjs";

function tokenLimit(key, value) {
  return { [key]: value };
}

function requireZod(zod) {
  if (!zod) {
    throw new Error("runAISDKScenario requires a zod instance");
  }

  return zod;
}

function createWeatherTool(ai, schemaKey, zod) {
  const z = requireZod(zod);
  const zodSchema = z.object({
    location: z.string().describe("The city and country"),
  });

  return ai.tool({
    description: "Get the weather for a location",
    [schemaKey]: zodSchema,
    execute: async (args) =>
      JSON.stringify({
        condition: "sunny",
        location: args.location,
        temperatureC: 22,
      }),
  });
}

export async function runAISDKScenario(options) {
  const z = requireZod(options.zod);
  const instrumentedAI = options.decorateAI
    ? options.decorateAI(options.ai)
    : options.ai;
  const openaiModel = options.openai("gpt-4o-mini");

  await runTracedScenario({
    callback: async () => {
      await runOperation("ai-sdk-generate-operation", "generate", async () => {
        await instrumentedAI.generateText({
          model: openaiModel,
          prompt: "Reply with the single token PARIS and no punctuation.",
          temperature: 0,
          ...tokenLimit(options.maxTokensKey, 16),
        });
      });

      await runOperation("ai-sdk-stream-operation", "stream", async () => {
        const result = await instrumentedAI.streamText({
          model: openaiModel,
          prompt: "Count from 1 to 3 and include the words one two three.",
          temperature: 0,
          ...tokenLimit(options.maxTokensKey, 32),
        });
        for await (const _chunk of result.textStream) {
        }
      });

      await runOperation("ai-sdk-tool-operation", "tool", async () => {
        const toolRequest = {
          model: openaiModel,
          prompt:
            "Use the get_weather tool for Paris, France. If you do not call the tool, the answer is invalid.",
          system:
            "You must inspect live weather via the provided get_weather tool before responding.",
          temperature: 0,
          tools: {
            get_weather: createWeatherTool(
              options.ai,
              options.toolSchemaKey,
              z,
            ),
          },
          ...tokenLimit(options.maxTokensKey, 128),
        };

        if (options.supportsToolExecution) {
          toolRequest.toolChoice = "required";
          toolRequest.stopWhen = options.ai.stepCountIs(4);
        }

        await instrumentedAI.generateText(toolRequest);
      });

      if (options.supportsGenerateObject) {
        await runOperation(
          "ai-sdk-generate-object-operation",
          "generate-object",
          async () => {
            await instrumentedAI.generateObject({
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
          async () => {
            const result = await instrumentedAI.streamObject({
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
          async () => {
            const AgentClass = instrumentedAI[options.agentClassExport];
            const agent = new AgentClass({
              model: openaiModel,
              system: "You are a terse assistant.",
            });
            await agent.generate({
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly HELLO and no punctuation.",
                },
              ],
              ...tokenLimit(options.maxTokensKey, 16),
            });
          },
        );

        await runOperation(
          "ai-sdk-agent-stream-operation",
          "agent-stream",
          async () => {
            const AgentClass = instrumentedAI[options.agentClassExport];
            const agent = new AgentClass({
              model: openaiModel,
              system: "You are a terse assistant.",
            });
            const result = await agent.stream({
              messages: [
                {
                  role: "user",
                  content:
                    "Reply with exactly STREAM HELLO and no punctuation.",
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
    flushCount: options.flushCount,
    flushDelayMs: options.flushDelayMs,
    metadata: {
      aiSdkVersion: options.sdkVersion,
      scenario: options.scenarioName,
    },
    projectNameBase: options.projectNameBase,
    rootName: options.rootName,
  });
}
