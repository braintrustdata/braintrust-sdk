import assert from "node:assert/strict";
import { OAuth2Client } from "google-auth-library";
import { wrapAnthropic } from "braintrust";
import {
  collectAsync,
  runOperation,
  runTracedScenario,
} from "../../helpers/provider-runtime.mjs";

export const ROOT_NAME = "anthropic-vertex-instrumentation-root";
export const SCENARIO_NAME = "anthropic-vertex-instrumentation";

async function runAnthropicVertexInstrumentationScenario(options) {
  const replay = process.env.BRAINTRUST_E2E_CASSETTE_MODE === "replay";
  const authClient = new OAuth2Client();
  authClient.setCredentials({
    access_token: replay ? "cassette-placeholder" : process.env.VERTEX_API_KEY,
  });
  const baseClient = new options.AnthropicVertex({
    authClient,
    projectId: replay
      ? "cassette-project"
      : (process.env.VERTEX_PROJECT_ID ??
        process.env.ANTHROPIC_VERTEX_PROJECT_ID),
    region: process.env.CLOUD_ML_REGION || "global",
    baseURL: process.env.ANTHROPIC_VERTEX_BASE_URL,
    maxRetries: 0,
  });
  const client = options.decorateClient
    ? options.decorateClient(baseClient)
    : baseClient;
  const model = "claude-sonnet-4-5@20250929";

  await runTracedScenario({
    callback: async () => {
      for (const beta of [false, true]) {
        const messages = beta ? client.beta.messages : client.messages;
        const prefix = beta ? "beta-" : "";
        await runOperation(
          `anthropic-vertex-${prefix}create-operation`,
          "create",
          async () => {
            const result = await messages
              .create({
                model,
                max_tokens: 32,
                messages: [{ role: "user", content: "Reply with exactly OK." }],
                temperature: 0,
              })
              .withResponse();
            assert.equal(result.response.status, 200);
            assert.equal(result.data.role, "assistant");
          },
        );
        await runOperation(
          `anthropic-vertex-${prefix}stream-operation`,
          "stream",
          async () => {
            const stream = await messages.create({
              model,
              max_tokens: 32,
              messages: [{ role: "user", content: "Count from one to three." }],
              stream: true,
              temperature: 0,
            });
            const events = await collectAsync(stream);
            assert(events.some((event) => event.type === "message_stop"));
          },
        );
        await runOperation(
          `anthropic-vertex-${prefix}stream-helper-operation`,
          "stream-helper",
          async () => {
            const stream = messages.stream({
              model,
              max_tokens: 32,
              messages: [
                { role: "user", content: "Reply with exactly Hello." },
              ],
              temperature: 0,
            });
            const result = await stream.finalMessage();
            assert.equal(result.role, "assistant");
            assert(result.content.length > 0);
          },
        );
      }
    },
    metadata: { scenario: SCENARIO_NAME },
    projectNameBase: "tmp-luca-e2e-anthropic-vertex-instrumentation",
    rootName: ROOT_NAME,
  });
}

export async function runWrappedAnthropicVertexInstrumentation(options) {
  await runAnthropicVertexInstrumentationScenario({
    decorateClient: wrapAnthropic,
    ...options,
  });
}

export async function runAutoAnthropicVertexInstrumentation(options) {
  await runAnthropicVertexInstrumentationScenario(options);
}
