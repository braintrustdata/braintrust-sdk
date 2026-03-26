# AI SDK TelemetryIntegration Migration Guide

> **Prototype Notice:** This integration targets AI SDK v7+ (beta) which exposes a first-class `TelemetryIntegration` lifecycle. It currently covers `generateText` and `streamText`. `generateObject` and `streamObject` will be added in a future release.

## Background

Braintrust has historically provided tracing for the Vercel AI SDK through the `wrapAISDK(...)` proxy approach. Starting with AI SDK v7, the SDK exposes a new `TelemetryIntegration` interface that lets integrations receive lifecycle events directly — no proxy needed.

The `BraintrustTelemetryIntegration` is Braintrust's first-party implementation of this interface.

## Quick Start

### Install

```bash
npm install braintrust ai@7.0.0-beta.42
```

### Register Globally (Recommended)

```typescript
import { registerTelemetryIntegration } from "ai";
import { BraintrustTelemetryIntegration } from "braintrust";

// Register once at startup — all generateText/streamText calls get traced
registerTelemetryIntegration(new BraintrustTelemetryIntegration());
```

### Register Per-Call

```typescript
import { generateText } from "ai";
import { BraintrustTelemetryIntegration } from "braintrust";

const integration = new BraintrustTelemetryIntegration();

const result = await generateText({
  model: openai("gpt-4"),
  prompt: "Hello world",
  experimental_telemetry: {
    integrations: [integration],
  },
});
```

## Passing Braintrust Metadata

Custom span names, metadata, and span attributes are passed through `experimental_telemetry.metadata.braintrust`:

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: openai("gpt-4"),
  prompt: "Summarize this document",
  experimental_telemetry: {
    metadata: {
      braintrust: {
        name: "document-summarizer",
        metadata: { documentId: "doc-123", user: "alice" },
        spanAttributes: { type: "function" },
      },
    },
  },
});
```

### Metadata Fields

| Field            | Type                      | Description                                                                        |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `name`           | `string`                  | Custom name for the root Braintrust span (default: `generateText` or `streamText`) |
| `metadata`       | `Record<string, unknown>` | Additional metadata attached to the Braintrust span                                |
| `spanAttributes` | `Record<string, unknown>` | Custom span attributes (e.g., `{ type: "function" }`)                              |

## Migration from `wrapAISDK`

### Concept Mapping

| `wrapAISDK` (old)          | `TelemetryIntegration` (new)                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `wrapAISDK(ai)`            | `registerTelemetryIntegration(new BraintrustTelemetryIntegration())` |
| `span_info.name`           | `experimental_telemetry.metadata.braintrust.name`                    |
| `span_info.metadata`       | `experimental_telemetry.metadata.braintrust.metadata`                |
| `span_info.spanAttributes` | `experimental_telemetry.metadata.braintrust.spanAttributes`          |
| Wrapper owns tracing       | Integration owns tracing                                             |

### Before: `wrapAISDK` with `generateText`

```typescript
import { wrapAISDK } from "braintrust";
import * as ai from "ai";

const { generateText } = wrapAISDK(ai);

const result = await generateText({
  model: openai("gpt-4"),
  prompt: "Reply with PARIS",
  span_info: {
    name: "city-lookup",
    metadata: { region: "europe" },
  },
});
```

### After: `TelemetryIntegration` with `generateText`

```typescript
import { registerTelemetryIntegration, generateText } from "ai";
import { BraintrustTelemetryIntegration } from "braintrust";

registerTelemetryIntegration(new BraintrustTelemetryIntegration());

const result = await generateText({
  model: openai("gpt-4"),
  prompt: "Reply with PARIS",
  experimental_telemetry: {
    metadata: {
      braintrust: {
        name: "city-lookup",
        metadata: { region: "europe" },
      },
    },
  },
});
```

### Before: `wrapAISDK` with `streamText`

```typescript
import { wrapAISDK } from "braintrust";
import * as ai from "ai";

const { streamText } = wrapAISDK(ai);

const result = streamText({
  model: openai("gpt-4"),
  prompt: "Count to 3",
  span_info: {
    name: "counting-stream",
  },
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

### After: `TelemetryIntegration` with `streamText`

```typescript
import { registerTelemetryIntegration, streamText } from "ai";
import { BraintrustTelemetryIntegration } from "braintrust";

registerTelemetryIntegration(new BraintrustTelemetryIntegration());

const result = streamText({
  model: openai("gpt-4"),
  prompt: "Count to 3",
  experimental_telemetry: {
    metadata: {
      braintrust: {
        name: "counting-stream",
      },
    },
  },
});

for await (const chunk of result.textStream) {
  console.log(chunk);
}
```

### Custom Span Name

```typescript
// Old (wrapper)
generateText({ ...params, span_info: { name: "my-span" } });

// New (integration)
generateText({
  ...params,
  experimental_telemetry: {
    metadata: { braintrust: { name: "my-span" } },
  },
});
```

### Custom Metadata

```typescript
// Old (wrapper)
generateText({
  ...params,
  span_info: { metadata: { env: "production", version: "1.2" } },
});

// New (integration)
generateText({
  ...params,
  experimental_telemetry: {
    metadata: {
      braintrust: { metadata: { env: "production", version: "1.2" } },
    },
  },
});
```

## Trace Shape

The integration produces the following trace structure:

### `generateText` (single step)

```
root span (generateText / custom-name)
  └── step-0 (LLM call)
```

### `generateText` with tool calls

```
root span (generateText / custom-name)
  ├── step-0 (LLM call → tool call)
  │   └── get_weather (tool execution)
  └── step-1 (LLM call → final response)
```

### `streamText`

```
root span (streamText / custom-name)
  └── step-0 (LLM call, includes time_to_first_token metric)
```

### What Gets Captured

| Data                                                 | Location                                |
| ---------------------------------------------------- | --------------------------------------- |
| System/prompt/messages                               | Root span `input`                       |
| Model ID                                             | Root span `metadata.model`              |
| Provider                                             | Root span `metadata.provider`           |
| Step messages                                        | Step span `input`                       |
| Step output (text, tool calls, finish reason, usage) | Step span `output`                      |
| Token usage metrics                                  | Step span and root span `metrics`       |
| Tool call input                                      | Tool span `input`                       |
| Tool call output                                     | Tool span `output`                      |
| Tool execution duration                              | Tool span `metrics.duration`            |
| Time to first token (streaming)                      | Step span `metrics.time_to_first_token` |
| Errors                                               | Span `error` field                      |

## Current Limitations

This is a prototype focused on validating the approach. The following are not yet supported:

- `generateObject` / `streamObject` — planned for a future release
- AI SDK versions prior to v7 — use `wrapAISDK` for v3–v6
- Mixed wrapper/integration coexistence — do not use both `wrapAISDK` and `BraintrustTelemetryIntegration` on the same call
- Agent class wrapping — the integration covers `generateText` and `streamText`; agent classes still use the wrapper

## API Reference

### `BraintrustTelemetryIntegration`

```typescript
import { BraintrustTelemetryIntegration } from "braintrust";

const integration = new BraintrustTelemetryIntegration();
```

Implements the AI SDK `TelemetryIntegration` interface with the following lifecycle hooks:

- `onStart` — Creates root Braintrust span
- `onStepStart` — Creates child step span
- `onToolCallStart` — Creates child tool span
- `onToolCallFinish` — Logs tool output/error and ends tool span
- `onChunk` — Tracks `time_to_first_token` for streaming
- `onStepFinish` — Logs step output/metrics and ends step span
- `onFinish` — Logs final output/metrics and ends root span
- `onError` — Logs error on all open spans and ends them
- `executeTool` — Runs tool execution within Braintrust span context (enables nested traces)

### `BraintrustTelemetryMetadata`

```typescript
import type { BraintrustTelemetryMetadata } from "braintrust";

const meta: BraintrustTelemetryMetadata = {
  name: "my-span",
  metadata: { key: "value" },
  spanAttributes: { type: "function" },
};
```
