import { expect, test } from "vitest";
import {
  createTestRunId,
  getPayloadsForRun,
  getRequestCursor,
  getRequestsAfter,
  getTestServerEnv,
} from "./helpers/ingestion";
import { normalizeForSnapshot, type Json } from "./helpers/normalize";
import {
  startMockBraintrustServer,
  CapturedLogRow,
  CapturedRequest,
} from "./helpers/mock-braintrust-server";
import { runScenarioOrThrow } from "./helpers/run-scenario";

function requireRow(
  rows: CapturedLogRow[],
  predicate: (row: CapturedLogRow) => boolean,
  label: string,
): CapturedLogRow {
  const match = rows.find(predicate);
  if (!match) {
    throw new Error(`Missing row: ${label}`);
  }
  return match;
}

function summarizeRequest(request: CapturedRequest): Json {
  return {
    jsonBody: (request.jsonBody ?? null) as Json,
    method: request.method,
    path: request.path,
  };
}

test("logging-and-datasets covers top-level rows, dataset CRUD payloads, and dataset fetch behavior", async () => {
  const server = await startMockBraintrustServer();

  try {
    const testRunId = createTestRunId();
    const requestCursor = await getRequestCursor(server.url);

    const result = await runScenarioOrThrow(
      "scenarios/logging-and-datasets.ts",
      getTestServerEnv(testRunId, server),
    );

    const payloads = await getPayloadsForRun(testRunId, server.url);
    const rows = payloads.flatMap((payload) => payload.rows);
    const requests = await getRequestsAfter(
      requestCursor,
      (request) => request.path === "/btql",
      server.url,
    );

    expect(
      normalizeForSnapshot(
        requireRow(
          rows,
          (row) =>
            (row.metadata as { kind?: string } | undefined)?.kind ===
            "project-log-row",
          "project-log-row",
        ) as Json,
      ),
    ).toMatchSnapshot("project-log-row");

    expect(
      normalizeForSnapshot(
        requireRow(
          rows,
          (row) =>
            (row.metadata as { kind?: string } | undefined)?.kind ===
            "experiment-row",
          "experiment-row",
        ) as Json,
      ),
    ).toMatchSnapshot("experiment-row");

    expect(
      normalizeForSnapshot(
        rows.filter((row) => typeof row.dataset_id === "string") as Json,
      ),
    ).toMatchSnapshot("dataset-payload-rows");

    expect(
      normalizeForSnapshot(requests.map(summarizeRequest) as Json),
    ).toMatchSnapshot("dataset-btql-requests");

    expect(
      normalizeForSnapshot(JSON.parse(result.stdout.trim()) as Json),
    ).toMatchSnapshot("dataset-fetch-results");
  } finally {
    await server.close();
  }
});
