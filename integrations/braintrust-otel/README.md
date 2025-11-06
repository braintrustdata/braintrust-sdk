# @braintrust/otel

OpenTelemetry integration for the Braintrust SDK. This package provides span processors, exporters, and utilities for seamlessly integrating Braintrust with OpenTelemetry instrumentation.

## Installation

```bash
npm install @braintrust/otel @opentelemetry/api @opentelemetry/sdk-trace-base
```

For full functionality, you may also need:

```bash
npm install @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
```

## Quick Start

### With NodeSDK

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BraintrustSpanProcessor } from '@braintrust/otel';

const sdk = new NodeSDK({
  spanProcessors: [
    new BraintrustSpanProcessor({
      apiKey: process.env.BRAINTRUST_API_KEY,
      parent: 'project_name:my-project',
    }),
  ],
});

sdk.start();
```

### With Vercel OTEL

```typescript
import { registerOTel } from '@vercel/otel';
import { BraintrustExporter } from '@braintrust/otel';

export function register() {
  registerOTel({
    serviceName: 'my-app',
    traceExporter: new BraintrustExporter({
      filterAISpans: true,
    }),
  });
}
```

### With Custom Tracer Provider

```typescript
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { BraintrustSpanProcessor } from '@braintrust/otel';

const provider = new BasicTracerProvider();
provider.addSpanProcessor(
  new BraintrustSpanProcessor({
    apiKey: 'your-api-key',
    parent: 'project_name:my-project',
    filterAISpans: true, // Only send AI-related spans
  })
);

provider.register();
```

## Features

### Span Processors

#### `BraintrustSpanProcessor`

Sends OpenTelemetry spans to Braintrust with optional AI span filtering.

**Options:**
- `apiKey` - Braintrust API key (or use `BRAINTRUST_API_KEY` env var)
- `parent` - Parent identifier like `"project_name:test"` (or use `BRAINTRUST_PARENT` env var)
- `apiUrl` - Braintrust API URL (defaults to `https://api.braintrust.dev`)
- `filterAISpans` - Enable AI span filtering (default: `false`)
- `customFilter` - Custom filter function for spans
- `headers` - Additional headers to send

#### `AISpanProcessor`

Filters spans to only export AI-related telemetry (spans with names/attributes starting with `gen_ai.`, `braintrust.`, `llm.`, `ai.`, or `traceloop.`).

```typescript
import { AISpanProcessor, BraintrustSpanProcessor } from '@braintrust/otel';

const processor = new BraintrustSpanProcessor({
  filterAISpans: true, // Internally uses AISpanProcessor
});
```

### Exporters

#### `BraintrustExporter`

Standard OTLP exporter compatible with any OpenTelemetry setup.

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BraintrustExporter } from '@braintrust/otel';

const exporter = new BraintrustExporter({
  apiKey: 'your-api-key',
  parent: 'project_name:test',
});

const processor = new BatchSpanProcessor(exporter);
```

### Context Manager

#### `OtelContextManager`

Integrates Braintrust spans with OpenTelemetry context propagation.

```typescript
import { setContextManager } from 'braintrust';
import { OtelContextManager } from '@braintrust/otel';

setContextManager(new OtelContextManager());
```

### Distributed Tracing Utilities

#### `otelContextFromSpanExport(exportStr)`

Creates an OTEL context from a Braintrust span export string.

```typescript
import { otelContextFromSpanExport } from '@braintrust/otel';
import * as api from '@opentelemetry/api';

// Service A exports a Braintrust span
const exportStr = await span.export();

// Service B creates OTEL child span
const ctx = otelContextFromSpanExport(exportStr);
await api.context.with(ctx, async () => {
  // OTEL spans here will be children of the Braintrust span
});
```

#### `addParentToBaggage(parent, ctx?)`

Adds `braintrust.parent` to OTEL baggage for propagation.

```typescript
import { addParentToBaggage } from '@braintrust/otel';

addParentToBaggage('project_name:my-project');
```

#### `parentFromHeaders(headers)`

Extracts a Braintrust-compatible parent from W3C trace context headers.

```typescript
import { parentFromHeaders } from '@braintrust/otel';
import { initLogger } from 'braintrust';

const parent = parentFromHeaders({
  traceparent: '00-trace_id-span_id-01',
  baggage: 'braintrust.parent=project_name:test',
});

const logger = initLogger({ projectName: 'my-project' });
await logger.traced(async (span) => {
  // This span is a child of the OTEL span
}, { name: 'my-span', parent });
```

## Environment Variables

- `BRAINTRUST_API_KEY` - Your Braintrust API key
- `BRAINTRUST_PARENT` - Parent identifier (e.g., `project_name:test`)
- `BRAINTRUST_API_URL` - Base URL for Braintrust API

## Migration from Core SDK

If you were previously importing OTEL components from the main `braintrust` package, update your imports:

```typescript
// Before
import { BraintrustSpanProcessor, otel } from 'braintrust';

// After
import { BraintrustSpanProcessor, otel } from '@braintrust/otel';
```

## License

MIT

