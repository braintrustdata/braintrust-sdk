import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { BraintrustSpanProcessor } from "./otel";
import { createTracerProvider } from "../tests/utils";
import { _exportsForTestingOnly } from "braintrust";

describe("BraintrustSpanProcessor - Real HTTP Exporter", () => {
  const TEST_API_KEY = "test-api-key-12345";
  const TEST_API_URL = "https://test-api.braintrust.dev";
  const TEST_PARENT = "project_name:test-export-project";

  let capturedRequests: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];

  const server = setupServer(
    http.post(`${TEST_API_URL}/otel/v1/traces`, async ({ request }) => {
      const body = await request.json();
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      capturedRequests.push({
        url: request.url,
        headers,
        body,
      });

      return HttpResponse.json({ success: true }, { status: 200 });
    }),
  );

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    capturedRequests = [];
    await _exportsForTestingOnly.simulateLoginForTests();
    _exportsForTestingOnly.useTestBackgroundLogger();
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
    _exportsForTestingOnly.simulateLogoutForTests();
  });

  it("should send spans via HTTP to correct OTLP endpoint with proper headers", async () => {
    // Create processor WITHOUT _spanProcessor to test real exporter path
    const processor = new BraintrustSpanProcessor({
      apiKey: TEST_API_KEY,
      apiUrl: TEST_API_URL,
      parent: TEST_PARENT,
    });

    const provider = createTracerProvider(BasicTracerProvider, [processor]);
    const tracer = provider.getTracer("test-tracer");

    // Create a span
    const span = tracer.startSpan("test-span");
    span.setAttribute("test.attribute", "test-value");
    span.end();

    // Flush to trigger HTTP export
    await processor.forceFlush();
    await provider.shutdown();

    // Verify HTTP request was made
    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);

    const request = capturedRequests[0];

    // Verify URL
    expect(request.url).toBe(`${TEST_API_URL}/otel/v1/traces`);

    // Verify headers
    expect(request.headers["authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
    expect(request.headers["x-bt-parent"]).toBe(TEST_PARENT);
    expect(request.headers["content-type"]).toContain("application/json");

    // Verify body structure (OTLP format)
    expect(request.body).toHaveProperty("resourceSpans");
  });

  it("should work with filterAISpans enabled", async () => {
    const processor = new BraintrustSpanProcessor({
      apiKey: TEST_API_KEY,
      apiUrl: TEST_API_URL,
      parent: TEST_PARENT,
      filterAISpans: true,
    });

    const provider = createTracerProvider(BasicTracerProvider, [processor]);
    const tracer = provider.getTracer("test-tracer");

    // Create root and AI spans
    const rootSpan = tracer.startSpan("root-operation");
    const aiSpan = tracer.startSpan("gen_ai.completion");
    aiSpan.end();
    rootSpan.end();

    await processor.forceFlush();
    await provider.shutdown();

    // Should still make HTTP request with filtered spans
    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
    expect(capturedRequests[0].body).toHaveProperty("resourceSpans");
  });
});
