import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import type {
  CapturedLogEvent,
  CapturedLogEventBatch,
  CapturedLogPayload,
  CapturedLogPayloadBatch,
  CapturedRequest,
  CapturedRequestBatch,
  MockBraintrustServer,
} from "./mock-braintrust-server";

const MOCK_BRAINTRUST_URL_KEY = "mockBraintrustUrl";
const MOCK_BRAINTRUST_API_KEY_KEY = "mockBraintrustApiKey";
const DEFAULT_EVENT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export type EventPredicate = (event: CapturedLogEvent) => boolean;
export type PayloadPredicate = (payload: CapturedLogPayload) => boolean;
export type RequestPredicate = (request: CapturedRequest) => boolean;

export type WaitForEventOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function injectedString(key: string): string {
  return inject(key as never) as string;
}

function controlUrl(path: string, serverUrl?: string): URL {
  return new URL(path, serverUrl ?? injectedString(MOCK_BRAINTRUST_URL_KEY));
}

async function fetchControl<T>(
  path: string,
  body: Record<string, unknown>,
  serverUrl?: string,
): Promise<T> {
  const response = await fetch(controlUrl(path, serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Test server request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

function hasTestRunId(value: unknown, testRunId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasTestRunId(entry, testRunId));
  }

  if (!isRecord(value)) {
    return false;
  }

  if (value.testRunId === testRunId) {
    return true;
  }

  return Object.values(value).some((entry) => hasTestRunId(entry, testRunId));
}

function eventBatch(
  after = 0,
  serverUrl?: string,
): Promise<CapturedLogEventBatch> {
  return fetchControl<CapturedLogEventBatch>(
    "/_mock/events",
    { after },
    serverUrl,
  );
}

function payloadBatch(
  after = 0,
  serverUrl?: string,
): Promise<CapturedLogPayloadBatch> {
  return fetchControl<CapturedLogPayloadBatch>(
    "/_mock/payloads",
    { after },
    serverUrl,
  );
}

function requestBatch(
  after = 0,
  serverUrl?: string,
): Promise<CapturedRequestBatch> {
  return fetchControl<CapturedRequestBatch>(
    "/_mock/requests",
    { after },
    serverUrl,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createTestRunId(): string {
  return `e2e-${randomUUID()}`;
}

export function getTestServerEnv(
  testRunId: string,
  server?: Pick<MockBraintrustServer, "apiKey" | "url">,
): Record<string, string> {
  const url = server?.url ?? injectedString(MOCK_BRAINTRUST_URL_KEY);
  return {
    BRAINTRUST_API_KEY:
      server?.apiKey ?? injectedString(MOCK_BRAINTRUST_API_KEY_KEY),
    BRAINTRUST_API_URL: url,
    BRAINTRUST_APP_URL: url,
    BRAINTRUST_E2E_RUN_ID: testRunId,
  };
}

export function isTestRunEvent(
  event: CapturedLogEvent,
  testRunId: string,
): boolean {
  return hasTestRunId(event.row, testRunId);
}

export function isTestRunPayload(
  payload: CapturedLogPayload,
  testRunId: string,
): boolean {
  return payload.rows.some((row) => hasTestRunId(row, testRunId));
}

export async function getEvents(
  predicate?: EventPredicate,
  serverUrl?: string,
): Promise<CapturedLogEvent[]> {
  const { events } = await eventBatch(0, serverUrl);
  return predicate ? events.filter(predicate) : events;
}

export async function getPayloads(
  predicate?: PayloadPredicate,
  serverUrl?: string,
): Promise<CapturedLogPayload[]> {
  const { payloads } = await payloadBatch(0, serverUrl);
  return predicate ? payloads.filter(predicate) : payloads;
}

export async function getRequestCursor(serverUrl?: string): Promise<number> {
  const { cursor } = await requestBatch(0, serverUrl);
  return cursor;
}

export async function getRequests(
  predicate?: RequestPredicate,
  serverUrl?: string,
): Promise<CapturedRequest[]> {
  const { requests } = await requestBatch(0, serverUrl);
  return predicate ? requests.filter(predicate) : requests;
}

export async function getRequestsAfter(
  after: number,
  predicate?: RequestPredicate,
  serverUrl?: string,
): Promise<CapturedRequest[]> {
  const { requests } = await requestBatch(after, serverUrl);
  return predicate ? requests.filter(predicate) : requests;
}

export async function getPayloadsForRun(
  testRunId: string,
  serverUrl?: string,
): Promise<CapturedLogPayload[]> {
  return await getPayloads(
    (payload) => isTestRunPayload(payload, testRunId),
    serverUrl,
  );
}

export async function waitForEvent(
  predicate: EventPredicate,
  options: WaitForEventOptions = {},
  serverUrl?: string,
): Promise<CapturedLogEvent> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EVENT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;

  while (Date.now() <= deadline) {
    const batch = await eventBatch(cursor, serverUrl);
    cursor = batch.cursor;

    const match = batch.events.find(predicate);
    if (match) {
      return match;
    }

    if (Date.now() >= deadline) {
      break;
    }

    await delay(Math.min(pollIntervalMs, Math.max(deadline - Date.now(), 0)));
  }

  throw new Error(
    `Timed out waiting for a matching event after ${timeoutMs}ms`,
  );
}

export async function waitForRunEvent(
  testRunId: string,
  predicate: EventPredicate,
  options: WaitForEventOptions = {},
  serverUrl?: string,
): Promise<CapturedLogEvent> {
  return await waitForEvent(
    (event) => isTestRunEvent(event, testRunId) && predicate(event),
    options,
    serverUrl,
  );
}
