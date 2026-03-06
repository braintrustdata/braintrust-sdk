import { createServer } from "node:http";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface CapturedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
  jsonBody: JsonValue | null;
}

export type CapturedRequestBatch = {
  cursor: number;
  requests: CapturedRequest[];
};

export type CapturedLogRow = Record<string, unknown>;

export type CapturedLogPayload = {
  api_version: number;
  rows: CapturedLogRow[];
};

export type CapturedLogEvent = {
  apiVersion: number;
  context?: Record<string, unknown>;
  expected?: unknown;
  experimentId?: string;
  input?: unknown;
  isMerge: boolean;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  output?: unknown;
  projectId?: string;
  row: CapturedLogRow;
  scores?: unknown;
  span: {
    ended: boolean;
    id?: string;
    name?: string;
    parentIds: string[];
    rootId?: string;
    started: boolean;
    type?: string;
  };
};

export interface MockBraintrustServer {
  apiKey: string;
  close: () => Promise<void>;
  url: string;
}

export type CapturedLogEventBatch = {
  cursor: number;
  events: CapturedLogEvent[];
};

export type CapturedLogPayloadBatch = {
  cursor: number;
  payloads: CapturedLogPayload[];
};

const CONTROL_ROUTE_PREFIX = "/_mock";
const DEFAULT_API_KEY = "mock-braintrust-api-key";

type ProjectRecord = {
  id: string;
  name: string;
};

type ExperimentRecord = {
  created: string;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
};

type DatasetRecord = {
  created: string;
  description?: string;
  id: string;
  metadata?: Record<string, unknown>;
  name: string;
  projectId: string;
  projectName: string;
};

type DatasetVersionEntry = {
  deleted: boolean;
  order: number;
  row: CapturedLogRow;
  xactId: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>(
    (normalized, [key, value]) => {
      if (value === undefined) {
        return normalized;
      }

      normalized[key] = Array.isArray(value) ? value.join(", ") : value;
      return normalized;
    },
    {},
  );
}

function parseJson(rawBody: string): JsonValue | null {
  if (!rawBody.trim()) {
    return null;
  }

  return JSON.parse(rawBody) as JsonValue;
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function isAuthorized(
  headers: Record<string, string>,
  apiKey: string,
): boolean {
  return headers.authorization === `Bearer ${apiKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parsePayload(request: CapturedRequest): CapturedLogPayload | null {
  const body = request.jsonBody;
  if (!isRecord(body) || !Array.isArray(body.rows)) {
    return null;
  }

  return {
    api_version: typeof body.api_version === "number" ? body.api_version : 0,
    rows: body.rows.reduce<CapturedLogRow[]>((capturedRows, row) => {
      if (isRecord(row)) {
        capturedRows.push(clone(row));
      }
      return capturedRows;
    }, []),
  };
}

function rowKey(row: CapturedLogRow): string {
  return JSON.stringify(
    [
      "org_id",
      "project_id",
      "experiment_id",
      "dataset_id",
      "prompt_session_id",
      "log_id",
      "id",
    ].map((key) => row[key]),
  );
}

function mergeValue(base: unknown, incoming: unknown): unknown {
  if (isRecord(base) && isRecord(incoming)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = key in merged ? mergeValue(merged[key], value) : value;
    }
    return merged;
  }

  return incoming;
}

function mergeRow(
  existing: CapturedLogRow | undefined,
  incoming: CapturedLogRow,
): CapturedLogRow {
  if (!existing || !incoming._is_merge) {
    return clone(incoming);
  }

  const preserveNoMerge = !existing._is_merge;
  const merged = mergeValue(existing, incoming) as CapturedLogRow;
  if (preserveNoMerge) {
    delete merged._is_merge;
  }
  return clone(merged);
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? clone(value) : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function toCapturedLogEvent(
  apiVersion: number,
  row: CapturedLogRow,
  rawRow: CapturedLogRow,
): CapturedLogEvent {
  const spanAttributes = recordField(row.span_attributes);
  const metrics = recordField(row.metrics);

  return {
    apiVersion,
    context: recordField(row.context),
    expected: clone(row.expected),
    experimentId: stringField(row.experiment_id),
    input: clone(row.input),
    isMerge: rawRow._is_merge === true,
    metadata: recordField(row.metadata),
    metrics,
    output: clone(row.output),
    projectId: stringField(row.project_id),
    row: clone(row),
    scores: clone(row.scores),
    span: {
      ended: typeof metrics?.end === "number",
      id: stringField(row.span_id),
      name: stringField(spanAttributes?.name),
      parentIds: arrayOfStrings(row.span_parents),
      rootId: stringField(row.root_span_id),
      started: typeof metrics?.start === "number",
      type: stringField(spanAttributes?.type),
    },
  };
}

export async function startMockBraintrustServer(
  apiKey = DEFAULT_API_KEY,
): Promise<MockBraintrustServer> {
  const requests: CapturedRequest[] = [];
  const payloads: CapturedLogPayload[] = [];
  const events: CapturedLogEvent[] = [];
  const mergedRows = new Map<string, CapturedLogRow>();
  const projects = new Map<string, ProjectRecord>();
  const experiments = new Map<string, ExperimentRecord>();
  const datasets = new Map<string, DatasetRecord>();
  const datasetVersions = new Map<string, Map<string, DatasetVersionEntry[]>>();
  const datasetRowOrder = new Map<string, number>();
  let datasetOrderCursor = 0;
  let xactCursor = 0;
  let serverUrl = "";

  function nextXactId(): string {
    xactCursor += 1;
    return String(xactCursor).padStart(12, "0");
  }

  function getDatasetKey(projectId: string, datasetName: string): string {
    return `${projectId}:${datasetName}`;
  }

  function getDatasetHistory(
    datasetId: string,
    rowId: string,
  ): DatasetVersionEntry[] {
    let datasetRows = datasetVersions.get(datasetId);
    if (!datasetRows) {
      datasetRows = new Map<string, DatasetVersionEntry[]>();
      datasetVersions.set(datasetId, datasetRows);
    }

    let rowHistory = datasetRows.get(rowId);
    if (!rowHistory) {
      rowHistory = [];
      datasetRows.set(rowId, rowHistory);
    }

    return rowHistory;
  }

  function compareXactIds(left: string, right: string): number {
    return left.localeCompare(right);
  }

  function recordDatasetVersion(row: CapturedLogRow): void {
    const datasetId = stringField(row.dataset_id);
    const rowId = stringField(row.id);
    const xactId = stringField(row._xact_id);

    if (!datasetId || !rowId || !xactId) {
      return;
    }

    const orderKey = `${datasetId}:${rowId}`;
    let order = datasetRowOrder.get(orderKey);
    if (order === undefined) {
      datasetOrderCursor += 1;
      order = datasetOrderCursor;
      datasetRowOrder.set(orderKey, order);
    }

    getDatasetHistory(datasetId, rowId).push({
      deleted: row._object_delete === true,
      order,
      row: clone(row),
      xactId,
    });
  }

  function datasetSnapshot(
    datasetId: string,
    version?: string,
  ): CapturedLogRow[] {
    const rows = datasetVersions.get(datasetId);
    if (!rows) {
      return [];
    }

    return [...rows.values()]
      .map((history) =>
        history.reduce<DatasetVersionEntry | undefined>((latest, entry) => {
          if (version && compareXactIds(entry.xactId, version) > 0) {
            return latest;
          }

          if (!latest || compareXactIds(entry.xactId, latest.xactId) >= 0) {
            return entry;
          }

          return latest;
        }, undefined),
      )
      .filter(
        (entry): entry is DatasetVersionEntry =>
          entry !== undefined && !entry.deleted,
      )
      .sort((left, right) => left.order - right.order)
      .map((entry) => clone(entry.row));
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const requestUrl = new URL(
          req.url ?? "/",
          serverUrl || "http://127.0.0.1",
        );
        const rawBody = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          req.on("error", reject);
        });

        const capturedRequest: CapturedRequest = {
          method: req.method ?? "GET",
          path: requestUrl.pathname,
          query: Object.fromEntries(requestUrl.searchParams.entries()),
          headers: normalizeHeaders(req.headers),
          rawBody,
          jsonBody: parseJson(rawBody),
        };

        if (capturedRequest.path.startsWith(CONTROL_ROUTE_PREFIX)) {
          const body = isRecord(capturedRequest.jsonBody)
            ? capturedRequest.jsonBody
            : {};
          const after =
            typeof body.after === "number" && body.after >= 0 ? body.after : 0;

          if (
            capturedRequest.method === "POST" &&
            capturedRequest.path === `${CONTROL_ROUTE_PREFIX}/requests`
          ) {
            respondJson(res, 200, {
              cursor: requests.length,
              requests: requests.slice(after),
            } satisfies CapturedRequestBatch);
            return;
          }

          if (
            capturedRequest.method === "POST" &&
            capturedRequest.path === `${CONTROL_ROUTE_PREFIX}/events`
          ) {
            respondJson(res, 200, {
              cursor: events.length,
              events: events.slice(after),
            } satisfies CapturedLogEventBatch);
            return;
          }

          if (
            capturedRequest.method === "POST" &&
            capturedRequest.path === `${CONTROL_ROUTE_PREFIX}/payloads`
          ) {
            respondJson(res, 200, {
              cursor: payloads.length,
              payloads: payloads.slice(after),
            } satisfies CapturedLogPayloadBatch);
            return;
          }

          respondJson(res, 404, {
            error: `Unhandled mock control route: ${capturedRequest.method} ${capturedRequest.path}`,
          });
          return;
        }

        requests.push(capturedRequest);

        if (!isAuthorized(capturedRequest.headers, apiKey)) {
          respondJson(res, 401, { error: "unauthorized" });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/apikey/login"
        ) {
          respondJson(res, 200, {
            org_info: [
              {
                id: "org:e2e",
                name: "e2e-org",
                api_url: serverUrl,
                proxy_url: serverUrl,
                git_metadata: { collect: "none" },
              },
            ],
          });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/project/register"
        ) {
          const body = (capturedRequest.jsonBody ?? {}) as {
            project_name?: string;
          };
          const projectName = body.project_name ?? "global";
          const project = projects.get(projectName) ?? {
            id: `project:${slugify(projectName) || "global"}`,
            name: projectName,
          };
          projects.set(projectName, project);

          respondJson(res, 200, { project });
          return;
        }

        if (
          capturedRequest.method === "GET" &&
          capturedRequest.path === "/api/project"
        ) {
          const projectId = capturedRequest.query.id ?? "project:unknown";
          const project = [...projects.values()].find(
            (candidate) => candidate.id === projectId,
          ) ?? {
            id: projectId,
            name: projectId.replace(/^project:/, ""),
          };

          respondJson(res, 200, { name: project.name, project });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/dataset/register"
        ) {
          const body = (capturedRequest.jsonBody ?? {}) as {
            project_name?: string;
            project_id?: string;
            dataset_name?: string;
            description?: string;
            metadata?: Record<string, unknown>;
          };
          const projectName = body.project_name ?? body.project_id ?? "project";
          const project = projects.get(projectName) ?? {
            id:
              body.project_id ?? `project:${slugify(projectName) || "project"}`,
            name: projectName,
          };
          projects.set(project.name, project);

          const datasetName = body.dataset_name ?? "dataset";
          const datasetKey = getDatasetKey(project.id, datasetName);
          const dataset = datasets.get(datasetKey) ?? {
            id: `dataset:${slugify(datasetName) || "dataset"}`,
            name: datasetName,
            created: "2026-01-01T00:00:00.000Z",
            projectId: project.id,
            projectName: project.name,
            description: body.description,
            metadata: body.metadata,
          };
          datasets.set(datasetKey, dataset);

          respondJson(res, 200, {
            project,
            dataset: {
              id: dataset.id,
              name: dataset.name,
              created: dataset.created,
              description: dataset.description,
              metadata: dataset.metadata,
            },
          });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/experiment/register"
        ) {
          const body = (capturedRequest.jsonBody ?? {}) as {
            project_name?: string;
            project_id?: string;
            experiment_name?: string;
          };
          const projectName = body.project_name ?? body.project_id ?? "project";
          const project = projects.get(projectName) ?? {
            id:
              body.project_id ?? `project:${slugify(projectName) || "project"}`,
            name: projectName,
          };
          projects.set(project.name, project);

          const experimentName = body.experiment_name ?? "experiment";
          const experimentKey = `${project.id}:${experimentName}`;
          const experiment = experiments.get(experimentKey) ?? {
            id: `experiment:${slugify(experimentName) || "experiment"}`,
            name: experimentName,
            created: "2026-01-01T00:00:00.000Z",
            projectId: project.id,
            projectName: project.name,
          };
          experiments.set(experimentKey, experiment);

          respondJson(res, 200, {
            project,
            experiment: {
              id: experiment.id,
              name: experiment.name,
              created: experiment.created,
            },
          });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/experiment/get"
        ) {
          const body = (capturedRequest.jsonBody ?? {}) as {
            project_name?: string;
            project_id?: string;
            experiment_name?: string;
          };
          const projectKey = body.project_name ?? body.project_id ?? "project";
          const project = projects.get(projectKey) ?? {
            id: `project:${slugify(projectKey) || "project"}`,
            name: projectKey,
          };
          const experimentName = body.experiment_name ?? "experiment";
          const experiment = experiments.get(
            `${project.id}:${experimentName}`,
          ) ?? {
            id: `experiment:${slugify(experimentName) || "experiment"}`,
            name: experimentName,
            created: "2026-01-01T00:00:00.000Z",
            projectId: project.id,
            projectName: project.name,
          };

          respondJson(res, 200, [
            {
              id: experiment.id,
              name: experiment.name,
              project_id: experiment.projectId,
              created: experiment.created,
            },
          ]);
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/api/base_experiment/get_id"
        ) {
          respondJson(res, 400, { error: "no base experiment" });
          return;
        }

        if (
          capturedRequest.method === "GET" &&
          capturedRequest.path === "/experiment-comparison2"
        ) {
          respondJson(res, 200, { scores: {}, metrics: {} });
          return;
        }

        if (
          capturedRequest.method === "GET" &&
          capturedRequest.path === "/dataset-summary"
        ) {
          const datasetId = capturedRequest.query.dataset_id ?? "";
          respondJson(res, 200, {
            total_records: datasetSnapshot(datasetId).length,
          });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/btql"
        ) {
          const body = isRecord(capturedRequest.jsonBody)
            ? capturedRequest.jsonBody
            : {};
          const query = isRecord(body.query) ? body.query : {};
          const from = isRecord(query.from) ? query.from : {};
          const name = isRecord(from.name) ? from.name : {};
          const args = Array.isArray(from.args) ? from.args : [];
          const firstArg =
            args.length > 0 && isRecord(args[0]) ? args[0] : undefined;
          const objectType =
            Array.isArray(name.name) && typeof name.name[0] === "string"
              ? name.name[0]
              : "";
          const objectId =
            firstArg && typeof firstArg.value === "string"
              ? firstArg.value
              : "";
          const limit =
            typeof query.limit === "number" && query.limit > 0
              ? query.limit
              : 1000;
          const offset =
            typeof query.cursor === "string"
              ? Number.parseInt(query.cursor, 10)
              : typeof query.cursor === "number"
                ? query.cursor
                : 0;
          const version =
            typeof body.version === "string" ? body.version : undefined;

          if (objectType === "dataset") {
            const records = datasetSnapshot(objectId, version);
            const page = records.slice(offset, offset + limit);
            respondJson(res, 200, {
              data: page,
              cursor:
                offset + limit < records.length ? String(offset + limit) : null,
            });
            return;
          }

          respondJson(res, 200, { data: [], cursor: null });
          return;
        }

        if (
          capturedRequest.method === "GET" &&
          capturedRequest.path === "/version"
        ) {
          respondJson(res, 200, { logs3_payload_max_bytes: null });
          return;
        }

        if (
          capturedRequest.method === "POST" &&
          capturedRequest.path === "/logs3"
        ) {
          const payload = parsePayload(capturedRequest);
          if (payload) {
            payloads.push(payload);

            for (const row of payload.rows) {
              const persistedRow = clone(row);
              if (typeof persistedRow._xact_id !== "string") {
                persistedRow._xact_id = nextXactId();
              }

              const key = rowKey(persistedRow);
              const mergedRow = mergeRow(mergedRows.get(key), persistedRow);
              mergedRows.set(key, mergedRow);
              recordDatasetVersion(mergedRow);
              events.push(
                toCapturedLogEvent(
                  payload.api_version,
                  mergedRow,
                  persistedRow,
                ),
              );
            }
          }

          respondJson(res, 200, { ok: true });
          return;
        }

        respondJson(res, 404, {
          error: `Unhandled mock route: ${capturedRequest.method} ${capturedRequest.path}`,
        });
      } catch (error) {
        respondJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  serverUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    apiKey,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: serverUrl,
  };
}
