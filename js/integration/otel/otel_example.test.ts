import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  BraintrustSpanProcessor,
  _exportsForTestingOnly,
  initLogger,
  TestBackgroundLogger,
} from "braintrust";
import type { BackgroundLogEvent } from "braintrust/util";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

type OtelAttributeValue =
  | { stringValue?: string }
  | { boolValue?: boolean }
  | { intValue?: string }
  | { doubleValue?: number }
  | { arrayValue?: { values?: OtelAttributeValue[] } }
  | {
      kvlistValue?: {
        values?: Array<{ key?: string; value?: OtelAttributeValue }>;
      };
    };

type OtelSpan = {
  name?: string;
  attributes?: Array<{ key?: string; value?: OtelAttributeValue }>;
};

type OtelExportPayload = {
  resourceSpans?: Array<{
    scopeSpans?: Array<{
      spans?: OtelSpan[];
    }>;
  }>;
};

function flattenSpans(payloads: OtelExportPayload[]): OtelSpan[] {
  return payloads.flatMap(
    (payload) =>
      payload.resourceSpans?.flatMap(
        (resourceSpan) =>
          resourceSpan.scopeSpans?.flatMap(
            (scopeSpan) => scopeSpan.spans ?? [],
          ) ?? [],
      ) ?? [],
  );
}

describe("otel integration example", () => {
  const receivedPayloads: OtelExportPayload[] = [];
  let otlpServer: ReturnType<typeof createServer> | undefined;
  let collectorUrl: string | undefined;
  let previousBraintrustApiUrl: string | undefined;

  beforeAll(async () => {
    _exportsForTestingOnly.setInitialTestState();
    await _exportsForTestingOnly.simulateLoginForTests();

    otlpServer = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/otel/v1/traces") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = Buffer.concat(chunks).toString();
            if (body.length > 0) {
              receivedPayloads.push(JSON.parse(body));
            }
          } catch (error) {
            throw error;
          } finally {
            res.writeHead(200).end();
          }
        });
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      otlpServer!.listen(0, "127.0.0.1", () => resolve());
    });

    const addressInfo = otlpServer!.address() as AddressInfo;
    collectorUrl = `http://127.0.0.1:${addressInfo.port}/`;
    previousBraintrustApiUrl = process.env.BRAINTRUST_API_URL;
    process.env.BRAINTRUST_API_URL = collectorUrl;
  });

  beforeEach(() => {
    receivedPayloads.length = 0;
  });

  afterAll(async () => {
    if (otlpServer) {
      await new Promise<void>((resolve, reject) => {
        otlpServer!.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      otlpServer = undefined;
    }
    process.env.BRAINTRUST_API_URL = previousBraintrustApiUrl;
  });

  test("exports spans through BraintrustSpanProcessor", async () => {
    if (!collectorUrl) {
      throw new Error("Collector URL not initialized");
    }

    const sdk = new NodeSDK({
      serviceName: "my-service",
      spanProcessor: new BraintrustSpanProcessor({
        filterAISpans: true,
      }) as unknown as SpanProcessor,
    });

    await sdk.start();

    try {
      const tracer = trace.getTracer("my-tracer", "1.0.0");

      await tracer.startActiveSpan("otel.example", async (rootSpan) => {
        rootSpan.setAttributes({
          "user.request": "my-request",
          "request.timestamp": new Date(
            "2025-01-01T00:00:00.000Z",
          ).toISOString(),
        });

        await tracer.startActiveSpan("chat.completion", async (aiSpan) => {
          aiSpan.setAttributes({
            model: "gpt-4o-mini",
          });
          aiSpan.end();
        });

        await tracer.startActiveSpan("logging span", async (span) => {
          span.end();
        });

        rootSpan.end();
      });
    } finally {
      await sdk.shutdown();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    const exportedSpans = flattenSpans(receivedPayloads);
    expect(exportedSpans.length).toBe(1);

    const names = exportedSpans
      .map((span) => span.name)
      .filter((name): name is string => typeof name === "string");
    expect(names).toContain("otel.example");
    // filters out ai spans
    expect(names).not.toContain("logging span");
    expect(names).not.toContain("chat.completion");

    const rootSpan = exportedSpans.find((span) => span.name === "otel.example");
    expect(rootSpan).toMatchSnapshot({
      traceId: expect.any(String),
      spanId: expect.any(String),
      name: "otel.example",
      kind: 1,
      startTimeUnixNano: expect.any(String),
      endTimeUnixNano: expect.any(String),
      attributes: [
        { key: "user.request", value: { stringValue: "my-request" } },
        {
          key: "request.timestamp",
          value: { stringValue: "2025-01-01T00:00:00.000Z" },
        },
      ],
      droppedAttributesCount: 0,
      events: [],
      droppedEventsCount: 0,
      status: { code: 0 },
      links: [],
      droppedLinksCount: 0,
    });
  });
});
