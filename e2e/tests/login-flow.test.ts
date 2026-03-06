import { expect, test } from "vitest";
import {
  createTestRunId,
  getRequestCursor,
  getRequestsAfter,
  getTestServerEnv,
} from "./helpers/ingestion";
import { normalizeForSnapshot, type Json } from "./helpers/normalize";
import {
  startMockBraintrustServer,
  type CapturedRequest,
} from "./helpers/mock-braintrust-server";
import { runScenarioOrThrow } from "./helpers/run-scenario";

function summarizeRequest(request: CapturedRequest): Json {
  return {
    headers: {
      authorization: request.headers.authorization ?? "",
    },
    jsonBody: (request.jsonBody ?? null) as Json,
    method: request.method,
    path: request.path,
  };
}

test("login-flow logs in once and reuses serialized state for object registration", async () => {
  const server = await startMockBraintrustServer();

  try {
    const requestCursor = await getRequestCursor(server.url);

    const result = await runScenarioOrThrow(
      "scenarios/login-flow.ts",
      getTestServerEnv(createTestRunId(), server),
    );

    const requests = await getRequestsAfter(
      requestCursor,
      undefined,
      server.url,
    );

    expect(
      requests.filter((request) => request.path === "/api/apikey/login"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/api/project/register"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/api/dataset/register"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.path === "/api/experiment/register"),
    ).toHaveLength(1);

    expect(
      normalizeForSnapshot(JSON.parse(result.stdout.trim()) as Json),
    ).toMatchSnapshot("stdout");
    expect(
      normalizeForSnapshot(requests.map(summarizeRequest) as Json),
    ).toMatchSnapshot("requests");
  } finally {
    await server.close();
  }
});
