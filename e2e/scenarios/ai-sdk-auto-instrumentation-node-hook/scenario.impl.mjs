import { initLogger, startSpan, withCurrent } from "braintrust";
import { z } from "zod";

const OPENAI_MODEL = "gpt-4o-mini";

function getTestRunId() {
  return process.env.BRAINTRUST_E2E_RUN_ID;
}

function scopedName(base, testRunId = getTestRunId()) {
  const suffix = testRunId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${base}-${suffix}`;
}

export async function runAISDKAutoInstrumentationNodeHook(
  ai,
  openai,
  aiSdkVersion,
  agentClassExport,
) {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-ai-sdk-auto-instrumentation-hook", testRunId),
  });

  const openaiModel = openai(OPENAI_MODEL);

  function createWeatherTool() {
    return ai.tool({
      description: "Get the weather for a location",
      inputSchema: z.object({
        location: z.string().describe("The city and country"),
      }),
      execute: async (args) =>
        JSON.stringify({
          condition: "sunny",
          location: args.location,
          temperatureC: 22,
        }),
    });
  }

  async function runOperation(name, operation, callback) {
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

  await logger.traced(
    async () => {
      await runOperation("ai-sdk-generate-operation", "generate", async () => {
        await ai.generateText({
          model: openaiModel,
          prompt: "Reply with the single token PARIS and no punctuation.",
          temperature: 0,
          maxOutputTokens: 16,
        });
      });

      await runOperation("ai-sdk-stream-operation", "stream", async () => {
        const result = await ai.streamText({
          model: openaiModel,
          prompt: "Count from 1 to 3 and include the words one two three.",
          temperature: 0,
          maxOutputTokens: 32,
        });
        for await (const _chunk of result.textStream) {
        }
      });

      await runOperation("ai-sdk-tool-operation", "tool", async () => {
        await ai.generateText({
          model: openaiModel,
          prompt:
            "Use the get_weather tool for Paris, France. If you do not call the tool, the answer is invalid.",
          system:
            "You must inspect live weather via the provided get_weather tool before responding.",
          temperature: 0,
          toolChoice: "required",
          tools: {
            get_weather: createWeatherTool(),
          },
          stopWhen: ai.stepCountIs(4),
          maxOutputTokens: 128,
        });
      });

      await runOperation(
        "ai-sdk-generate-object-operation",
        "generate-object",
        async () => {
          await ai.generateObject({
            model: openaiModel,
            prompt: 'Return JSON with {"city":"Paris"}.',
            schema: z.object({
              city: z.string(),
            }),
            temperature: 0,
            maxOutputTokens: 32,
          });
        },
      );

      await runOperation(
        "ai-sdk-stream-object-operation",
        "stream-object",
        async () => {
          const result = await ai.streamObject({
            model: openaiModel,
            prompt: 'Stream JSON with {"city":"Paris"}.',
            schema: z.object({
              city: z.string(),
            }),
            temperature: 0,
            maxOutputTokens: 32,
          });
          for await (const _partial of result.partialObjectStream) {
          }
          await result.object;
        },
      );

      const AgentClass = ai[agentClassExport];

      await runOperation(
        "ai-sdk-agent-generate-operation",
        "agent-generate",
        async () => {
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
            maxOutputTokens: 16,
          });
        },
      );

      await runOperation(
        "ai-sdk-agent-stream-operation",
        "agent-stream",
        async () => {
          const agent = new AgentClass({
            model: openaiModel,
            system: "You are a terse assistant.",
          });
          const result = await agent.stream({
            messages: [
              {
                role: "user",
                content: "Reply with exactly STREAM HELLO and no punctuation.",
              },
            ],
            maxOutputTokens: 16,
          });

          for await (const _chunk of result.textStream) {
          }
        },
      );
    },
    {
      name: "ai-sdk-auto-hook-root",
      event: {
        metadata: {
          aiSdkVersion,
          scenario: "ai-sdk-auto-instrumentation-node-hook",
          testRunId,
        },
      },
    },
  );

  // Give channel asyncEnd handlers time to enqueue their spans before process exit.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await logger.flush();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await logger.flush();
}

export function runAISDKAutoInstrumentationNodeHookOrExit(
  ai,
  openai,
  aiSdkVersion,
  agentClassExport,
) {
  void runAISDKAutoInstrumentationNodeHook(
    ai,
    openai,
    aiSdkVersion,
    agentClassExport,
  ).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
