# Temporal + AI SDK + Braintrust Example

This example demonstrates how to integrate the [Vercel AI SDK](https://sdk.vercel.ai/) with [Temporal](https://temporal.io/) workflows while using [Braintrust](https://braintrust.dev/) to trace both Temporal workflows and LLM calls.

## Features

This example is based on the temporalio/ai-sdk example [here](https://github.com/temporalio/samples-typescript/tree/main/ai-sdk).

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Temporal CLI (install with `brew install temporal` or `mise install`)
- OpenAI API key
- Braintrust API key

### Setup

1. **Copy environment variables:**

```bash
cp .env.example .env
```

2. **Edit `.env` and add your API keys:**

```bash
BRAINTRUST_API_KEY=your-braintrust-api-key
OPENAI_API_KEY=your-openai-api-key
```

3. **Install dependencies:**

```bash
pnpm install
```

4. **Build the Braintrust Temporal integration:**

```bash
pnpm run build:integration
```

### Running the Example

The easiest way to run this example is using **mise** (recommended):

#### Using Mise (Recommended)

**Terminal 1: Start Server + Worker**

```bash
mise run server
```

This starts both the Temporal server and worker with Braintrust tracing enabled.

**Terminal 2: Run Workflows**

```bash
# General workflow command (prompts for workflow type)
mise run workflow

# Or run specific workflows directly:
mise run workflow-haiku          # Simple tracing
mise run workflow-haiku-traced   # Full LLM tracing
mise run workflow-tools          # Function calling example
```

**Stop Everything:**

```bash
mise run stop    # Graceful shutdown
mise run kill    # Force kill all processes
```

#### Using pnpm Directly (Alternative)

If you prefer to run commands manually:

**Terminal 1: Start Temporal Server**

```bash
temporal server start-dev
```

**Terminal 2: Start the Worker**

```bash
pnpm run worker
```

The worker will connect to Temporal and initialize Braintrust tracing.

**Terminal 3: Run Workflows**

```bash
pnpm run workflow:haiku
pnpm run workflow:haiku-traced
pnpm run workflow:tools
```

## Important: AI SDK v6 Polyfills

AI SDK v6 uses the Web Streams API (`TransformStream`, `ReadableStream`, `WritableStream`), which is not available in Temporal's workflow sandbox by default. The `@temporalio/ai-sdk` package provides the necessary polyfills.

**Critical requirement**: You **must** import the polyfills at the top of your workflow file:

```typescript
// Load polyfills for AI SDK v6
import "@temporalio/ai-sdk/lib/load-polyfills";

import { generateText } from "ai";
import { temporalProvider } from "@temporalio/ai-sdk";
// ... rest of your imports
```

This import loads polyfills for:

- Web Streams API (`TransformStream`, `ReadableStream`, `WritableStream`)
- `Headers` API
- `structuredClone`

**Without this import**, you'll get a `ReferenceError: TransformStream is not defined` error when workflows try to call AI SDK functions.

All workflows in this example ([src/workflows.ts](src/workflows.ts)) include this import.

## Learn More

- [Temporal Documentation](https://docs.temporal.io/)
- [Vercel AI SDK Documentation](https://sdk.vercel.ai/)
- [Braintrust Documentation](https://www.braintrust.dev/docs)
- [Model Context Protocol](https://modelcontextprotocol.io/)
