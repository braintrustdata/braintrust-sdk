import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";

import {
  BraintrustSpanProcessor,
  TestBackgroundLogger,
  initLogger,
  _exportsForTestingOnly,
} from "braintrust";

type OtelExportPayload = {
  resourceSpans?: Array<{
    scopeSpans?: Array<{
      spans?: Array<{
        name?: string;
        attributes?: Array<{ key?: string; value?: { stringValue?: string } }>;
      }>;
    }>;
  }>;
};

function flattenSpans(payloads: OtelExportPayload[]) {
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

async function main() {
  const receivedPayloads: OtelExportPayload[] = [];

  const otlpServer = createServer((req, res) => {
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
          res.writeHead(500).end();
          throw error;
        }
        res.writeHead(200).end();
      });
      return;
    }

    res.writeHead(404).end();
  });

  const collectorUrl = await new Promise<string>((resolve) => {
    otlpServer.listen(0, "127.0.0.1", () => {
      const addressInfo = otlpServer.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addressInfo.port}/`);
    });
  });

  const previousApiUrl = process.env.BRAINTRUST_API_URL;
  process.env.BRAINTRUST_API_URL = collectorUrl;

  try {
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
          aiSpan.setAttributes({ model: "gpt-4o-mini" });
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

    await delay(50);

    const exportedSpans = flattenSpans(receivedPayloads);
    assert.ok(
      exportedSpans.length > 0,
      "No spans were exported to the collector",
    );

    const names = exportedSpans
      .map((span) => span.name)
      .filter((name): name is string => typeof name === "string");

    assert.ok(names.includes("otel.example"), "Root span missing");
    assert.ok(
      !names.includes("chat.completion"),
      "AI span should have been filtered",
    );
    assert.ok(
      !names.includes("logging span"),
      "Logging span should have been filtered",
    );
  } finally {
    process.env.BRAINTRUST_API_URL = previousApiUrl;
    await new Promise<void>((resolve, reject) => {
      otlpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
  console.log("Otel example passed");
}

main().catch((error) => {
  console.log("Otel example failed:", error);
  process.exitCode = 1;
});
