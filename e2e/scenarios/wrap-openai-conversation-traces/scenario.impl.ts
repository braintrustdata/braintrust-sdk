import { initLogger, startSpan, withCurrent, wrapOpenAI } from "braintrust";
import {
  collectAsync,
  getTestRunId,
  scopedName,
} from "../../helpers/scenario-runtime";

const OPENAI_MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MODERATION_MODEL = "omni-moderation-latest";

const CHAT_PARSE_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "number" },
  },
  required: ["answer"],
} as const;

const RESPONSES_PARSE_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    value: { type: "integer" },
  },
  required: ["value", "reasoning"],
  additionalProperties: false,
} as const;

type ChatHelperNamespace = "beta" | "ga";

async function collectOneAndReturn<T>(stream: AsyncIterable<T>): Promise<void> {
  for await (const _chunk of stream) {
    break;
  }
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

export async function runWrapOpenAIConversationTraces(
  OpenAI: any,
  openaiSdkVersion: string,
  chatHelperNamespace: ChatHelperNamespace,
) {
  const testRunId = getTestRunId();
  const logger = initLogger({
    projectName: scopedName("e2e-wrap-openai-conversation", testRunId),
  });
  const client = wrapOpenAI(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      baseURL: process.env.OPENAI_BASE_URL,
    }),
  );

  await logger.traced(
    async () => {
      await runOperation(
        "openai-chat-operation",
        "chat",
        testRunId,
        async () => {
          await client.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
              {
                role: "user",
                content: "Reply with exactly OK.",
              },
            ],
            max_tokens: 8,
            temperature: 0,
          });
        },
      );

      await runOperation(
        "openai-chat-with-response-operation",
        "chat-with-response",
        testRunId,
        async () => {
          await client.chat.completions
            .create({
              model: OPENAI_MODEL,
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly FOUR.",
                },
              ],
              max_tokens: 8,
              temperature: 0,
            })
            .withResponse();
        },
      );

      await runOperation(
        "openai-stream-operation",
        "stream",
        testRunId,
        async () => {
          const chatStream = await client.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
              {
                role: "user",
                content: "Reply with exactly STREAM.",
              },
            ],
            stream: true,
            max_tokens: 8,
            temperature: 0,
            stream_options: {
              include_usage: true,
            },
          });
          await collectAsync(chatStream);
        },
      );

      await runOperation(
        "openai-stream-with-response-operation",
        "stream-with-response",
        testRunId,
        async () => {
          const { data: chatStream } = await client.chat.completions
            .create({
              model: OPENAI_MODEL,
              messages: [
                {
                  role: "user",
                  content: "Reply with exactly STREAM-WITH-RESPONSE.",
                },
              ],
              stream: true,
              max_tokens: 16,
              temperature: 0,
              stream_options: {
                include_usage: true,
              },
            })
            .withResponse();
          await collectAsync(chatStream);
        },
      );

      await runOperation(
        "openai-parse-operation",
        "parse",
        testRunId,
        async () => {
          const parseArgs = {
            messages: [
              {
                role: "user",
                content: "What is 2 + 2?",
              },
            ],
            model: OPENAI_MODEL,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "math_response",
                schema: CHAT_PARSE_SCHEMA,
              },
            },
          };

          if (chatHelperNamespace === "beta") {
            await client.beta.chat.completions.parse(parseArgs);
          } else {
            await client.chat.completions.parse(parseArgs);
          }
        },
      );

      await runOperation(
        "openai-sync-stream-operation",
        "sync-stream",
        testRunId,
        async () => {
          const streamArgs = {
            model: OPENAI_MODEL,
            messages: [
              {
                role: "user",
                content: "Reply with exactly SYNC STREAM.",
              },
            ],
            max_tokens: 16,
            temperature: 0,
          };

          const runner =
            chatHelperNamespace === "beta"
              ? client.beta.chat.completions.stream(streamArgs)
              : client.chat.completions.stream(streamArgs);
          await runner.finalChatCompletion();
        },
      );

      await runOperation(
        "openai-embeddings-operation",
        "embeddings",
        testRunId,
        async () => {
          await client.embeddings.create({
            model: EMBEDDING_MODEL,
            input: "Paris",
          });
        },
      );

      await runOperation(
        "openai-moderations-operation",
        "moderations",
        testRunId,
        async () => {
          await client.moderations.create({
            model: MODERATION_MODEL,
            input: "Hello from Braintrust.",
          });
        },
      );

      await runOperation(
        "openai-responses-operation",
        "responses",
        testRunId,
        async () => {
          await client.responses.create({
            model: OPENAI_MODEL,
            input: "Reply with exactly PARIS.",
            max_output_tokens: 16,
          });
        },
      );

      await runOperation(
        "openai-responses-with-response-operation",
        "responses-with-response",
        testRunId,
        async () => {
          await client.responses
            .create({
              model: OPENAI_MODEL,
              input: "What is 2 + 2? Reply with just the number.",
              max_output_tokens: 16,
            })
            .withResponse();
        },
      );

      await runOperation(
        "openai-responses-create-stream-operation",
        "responses-create-stream",
        testRunId,
        async () => {
          const { data: responseStream } = await client.responses
            .create({
              model: OPENAI_MODEL,
              input: "Reply with exactly RESPONSE STREAM.",
              max_output_tokens: 16,
              stream: true,
            })
            .withResponse();
          await collectAsync(responseStream);
        },
      );

      await runOperation(
        "openai-responses-stream-operation",
        "responses-stream",
        testRunId,
        async () => {
          const stream = client.responses.stream({
            model: OPENAI_MODEL,
            input: "What is 6 x 6? Reply with just the number.",
            max_output_tokens: 16,
          });
          await collectAsync(stream);
          await stream.finalResponse();
        },
      );

      await runOperation(
        "openai-responses-stream-partial-operation",
        "responses-stream-partial",
        testRunId,
        async () => {
          const stream = client.responses.stream({
            model: OPENAI_MODEL,
            input: "Reply with exactly PARTIAL.",
            max_output_tokens: 16,
          });
          await collectOneAndReturn(stream);
        },
      );

      await runOperation(
        "openai-responses-parse-operation",
        "responses-parse",
        testRunId,
        async () => {
          await client.responses.parse({
            model: OPENAI_MODEL,
            input: "What is 20 + 4?",
            text: {
              format: {
                name: "NumberAnswer",
                type: "json_schema",
                schema: RESPONSES_PARSE_SCHEMA,
              },
            },
          });
        },
      );
    },
    {
      name: "openai-wrapper-root",
      event: {
        metadata: {
          scenario: "wrap-openai-conversation-traces",
          openaiSdkVersion,
          testRunId,
        },
      },
    },
  );

  await logger.flush();
}
