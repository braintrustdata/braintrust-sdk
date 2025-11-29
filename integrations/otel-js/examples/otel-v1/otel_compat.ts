/**
 * Demonstration of OpenTelemetry + Braintrust integration
 *
 * This example shows how OTEL and Braintrust spans can be mixed in the same trace,
 * with unified trace IDs and proper parent-child relationships.
 *
 * Requirements:
 * - @opentelemetry/api
 * - @opentelemetry/sdk-trace-base
 * - @opentelemetry/context-async-hooks (required for Node.js context propagation)
 *
 * Run with: npx tsx examples/otel-compat-demo.ts
 */

import { trace, context } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { initLogger, login } from "braintrust";
import { BraintrustSpanProcessor, initOtel } from "@braintrust/otel";

// Initialize Braintrust OpenTelemetry
initOtel();

function getExportVersion(exportedSpan: string): number {
  const exportedBytes = Buffer.from(exportedSpan, "base64");
  return exportedBytes[0];
}

async function main() {
  await login();
  console.log("🚀 Starting OTEL + Braintrust Integration Demo\n");

  const expectedVersion = 4;
  console.log(`Expected export version: ${expectedVersion}\n`);

  // Try to import AsyncHooksContextManager - it's optional but required for context propagation
  let AsyncHooksContextManager: any;
  try {
    const contextAsyncHooks = await import(
      "@opentelemetry/context-async-hooks"
    );
    AsyncHooksContextManager = contextAsyncHooks.AsyncHooksContextManager;
  } catch (e) {
    console.error("⚠️  @opentelemetry/context-async-hooks not found.");
    console.error(
      "   Install it with: npm install @opentelemetry/context-async-hooks",
    );
    console.error(
      "   This package is required for OTEL context propagation in Node.js",
    );
    process.exit(1);
  }

  // Register AsyncHooksContextManager for context propagation
  const contextManager = new AsyncHooksContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  // Create Braintrust span processor to export to Braintrust
  const braintrustProcessor = new BraintrustSpanProcessor({
    apiKey: process.env.BRAINTRUST_API_KEY,
    parent: "project_name:otel-v1-examples",
  });

  // Setup OpenTelemetry with Braintrust processor
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(braintrustProcessor);

  // Set as global tracer provider so OTEL context APIs work
  trace.setGlobalTracerProvider(provider);

  // Get tracer
  const tracer = provider.getTracer("demo-tracer");

  // Initialize Braintrust logger
  const logger = initLogger({
    projectName: "otel-v1-examples",
  });

  console.log("📊 Demo 1: BT root span with OTEL instrumentation inside\n");

  let trace1Link: string | undefined;
  await logger.traced(
    async (rootSpan) => {
      trace1Link = rootSpan.link();
      console.log(
        `  trace1_root_bt: span_id=${rootSpan.spanId.slice(0, 16)}... root_span_id=${rootSpan.rootSpanId.slice(0, 16)}...`,
      );

      // Export the span and verify format
      const exported = await rootSpan.export();
      const versionByte = getExportVersion(exported);
      console.log(
        `  exported (version ${versionByte}): ${exported.slice(0, 60)}...`,
      );
      if (versionByte !== expectedVersion) {
        throw new Error(
          `Expected version ${expectedVersion} but got ${versionByte}`,
        );
      }
      console.log(`  ✓ Version verified: ${versionByte}`);

      rootSpan.log({ input: "BT root span", metadata: { type: "root" } });

      await tracer.startActiveSpan("trace1_child_otel", async (otelSpan) => {
        const ctx = otelSpan.spanContext();
        console.log(
          `  trace1_child_otel: trace_id=${ctx.traceId.slice(0, 16)}...`,
        );
        otelSpan.setAttribute("type", "otel_inside_bt");
        otelSpan.addEvent("start");

        await tracer.startActiveSpan(
          "trace1_grandchild_otel",
          async (nestedOtel) => {
            nestedOtel.setAttribute("type", "nested_otel");
            console.log(
              `  trace1_grandchild_otel: trace_id=${nestedOtel.spanContext().traceId.slice(0, 16)}...`,
            );
            nestedOtel.end();
          },
        );

        await logger.traced(
          async (btSpan) => {
            console.log(
              `  trace1_grandchild_bt_traced: span_id=${btSpan.spanId.slice(0, 16)}... root_span_id=${btSpan.rootSpanId.slice(0, 16)}...`,
            );
          },
          { name: "trace1_grandchild_bt_traced" },
        );

        otelSpan.addEvent("end");
        otelSpan.end();
      });

      await logger.traced(
        async (btSpan) => {
          console.log(
            `  trace1_child_bt_traced: span_id=${btSpan.spanId.slice(0, 16)}... root_span_id=${btSpan.rootSpanId.slice(0, 16)}...`,
          );
        },
        { name: "trace1_child_bt_traced" },
      );
    },
    { name: "trace1_root_bt" },
  );

  console.log("\n📊 Demo 2: OTEL root span with BT spans inside\n");

  let trace2Link: string | undefined;
  await tracer.startActiveSpan("trace2_root_otel", async (otelRoot) => {
    const ctx1 = otelRoot.spanContext();
    const otelTraceId = ctx1.traceId.toString().padStart(32, "0");
    console.log(`  trace2_root_otel: trace_id=${otelTraceId.slice(0, 16)}...`);
    otelRoot.setAttribute("type", "otel_root");
    otelRoot.addEvent("otel_root_start");

    await logger.traced(
      async (btSpan) => {
        trace2Link = btSpan.link();
        console.log(
          `  trace2_child_bt: span_id=${btSpan.spanId.slice(0, 16)}... root_span_id=${btSpan.rootSpanId.slice(0, 16)}...`,
        );

        // Export the span and verify format
        const exported = await btSpan.export();
        const versionByte = getExportVersion(exported);
        console.log(
          `  exported (version ${versionByte}): ${exported.slice(0, 60)}...`,
        );
        if (versionByte !== expectedVersion) {
          throw new Error(
            `Expected version ${expectedVersion} but got ${versionByte}`,
          );
        }
        console.log(`  ✓ Version verified: ${versionByte}`);

        btSpan.log({
          input: "BT span inside OTEL",
          metadata: { type: "bt_inside_otel" },
        });

        await tracer.startActiveSpan(
          "trace2_grandchild_otel",
          async (otelGrandchild) => {
            otelGrandchild.setAttribute("type", "otel_grandchild");
            otelGrandchild.addEvent("otel_grandchild_start");
            console.log(
              `  trace2_grandchild_otel: trace_id=${otelGrandchild.spanContext().traceId.slice(0, 16)}...`,
            );
            otelGrandchild.end();
          },
        );

        await logger.traced(
          async () => {
            console.log(`  trace2_grandchild_bt1`);
          },
          { name: "trace2_grandchild_bt1" },
        );

        await btSpan.traced(
          async (btGrandchild) => {
            console.log(
              `  trace2_grandchild_bt: span_id=${btGrandchild.spanId.slice(0, 16)}... root_span_id=${btGrandchild.rootSpanId.slice(0, 16)}...`,
            );
            btGrandchild.log({
              input: "Nested BT span",
              output: "unified trace",
              scores: { accuracy: 0.88 },
            });
          },
          { name: "trace2_grandchild_bt" },
        );
      },
      { name: "trace2_child_bt" },
    );

    await logger.traced(
      async () => {
        console.log(`  trace2_child_bt_traced`);
      },
      { name: "trace2_child_bt_traced" },
    );

    otelRoot.addEvent("otel_root_end");
    otelRoot.end();
  });

  await logger.flush();
  await braintrustProcessor.forceFlush();

  console.log("\n✅ Done! View traces at:");
  if (trace1Link) {
    console.log(`   Trace 1: ${trace1Link}`);
  }
  if (trace2Link) {
    console.log(`   Trace 2: ${trace2Link}`);
  }
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exit(1);
});
