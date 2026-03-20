import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "./provider-runtime.mjs";

const CHAT_MODEL = "openai/gpt-4.1-mini";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export async function runOpenRouterScenario(options) {
  const baseClient = new options.OpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });
  const client = options.decorateClient
    ? options.decorateClient(baseClient)
    : baseClient;

  await runTracedScenario({
    callback: async () => {
      await runOperation("openrouter-chat-operation", "chat", async () => {
        await client.chat.send({
          chatGenerationParams: {
            model: CHAT_MODEL,
            messages: [{ role: "user", content: "Reply with exactly OK." }],
            maxTokens: 16,
            temperature: 0,
          },
        });
      });

      await runOperation(
        "openrouter-chat-stream-operation",
        "chat-stream",
        async () => {
          const stream = await client.chat.send({
            chatGenerationParams: {
              model: CHAT_MODEL,
              messages: [
                { role: "user", content: "Reply with exactly STREAM." },
              ],
              maxTokens: 16,
              stream: true,
              streamOptions: {
                includeUsage: true,
              },
              temperature: 0,
            },
          });
          await collectAsync(stream);
        },
      );

      await runOperation(
        "openrouter-embeddings-operation",
        "embeddings",
        async () => {
          await client.embeddings.generate({
            requestBody: {
              input: "braintrust tracing",
              inputType: "query",
              model: EMBEDDING_MODEL,
            },
          });
        },
      );

      await runOperation(
        "openrouter-responses-operation",
        "responses",
        async () => {
          await client.beta.responses.send({
            openResponsesRequest: {
              input: "Reply with exactly OBSERVABILITY.",
              maxOutputTokens: 16,
              model: CHAT_MODEL,
              temperature: 0,
            },
          });
        },
      );

      await runOperation(
        "openrouter-responses-stream-operation",
        "responses-stream",
        async () => {
          const stream = await client.beta.responses.send({
            openResponsesRequest: {
              input: "Reply with exactly STREAMED RESPONSE.",
              maxOutputTokens: 16,
              model: CHAT_MODEL,
              stream: true,
              temperature: 0,
            },
          });
          await collectAsync(stream);
        },
      );

      await runOperation(
        "openrouter-call-model-operation",
        "call-model",
        async () => {
          const result = client.callModel({
            input:
              "Use the lookup_weather tool for Vienna exactly once, then answer with only the forecast.",
            maxOutputTokens: 16,
            maxToolCalls: 1,
            model: CHAT_MODEL,
            temperature: 0,
            toolChoice: "required",
            tools: [options.createWeatherTool()],
          });

          await result.getText();
        },
      );
    },
    metadata: {
      openrouterSdkVersion: options.openrouterSdkVersion,
      scenario: options.scenarioName,
    },
    projectNameBase: options.projectNameBase,
    rootName: options.rootName,
  });
}
