# Temporal + AI SDK + Braintrust Example

This example demonstrates how to integrate the [Vercel AI SDK](https://sdk.vercel.ai/) with [Temporal](https://temporal.io/) workflows while using [Braintrust](https://braintrust.dev/) to trace both Temporal workflows and LLM calls.

## Integration Patterns

### TemporalProvider + AiSdkPlugin and wrapping the model provider

**Best for:** Workflows where you want clean code like Pattern 1 but need LLM observability.

Wraps the AI SDK provider with Braintrust tracing before passing it to Temporal's `AiSdkPlugin`. Workflows still use `temporalProvider` but get automatic LLM tracing.

**Setup:** [worker.ts](src/worker.ts#L32-L48)

```typescript
import { wrapAISDKProvider } from "braintrust";

// Wrap the provider to add tracing
const tracedOpenAI = wrapAISDKProvider(openai);

const worker = await Worker.create({
  plugins: [
    new AiSdkPlugin({
      modelProvider: tracedOpenAI, // Use traced provider
    }),
    new BraintrustTemporalPlugin(),
  ],
});
```

**Trace hierarchy:**

```
temporal.workflow.haikuAgent
  └── temporal.activity.invokeModel
      └── doGenerate  ← LLM span with full details
          ├── input: { prompt: "...", system: "..." }
          ├── output: { text: "...", finishReason: "stop" }
          └── metrics: { promptTokens: 15, completionTokens: 20 }
```

---

### Custom Activities with wrapAISDK

Creates explicit activities that use Braintrust's `wrapAISDK` for comprehensive instrumentation. Provides the most detailed tracing including tool calls and streaming.

**Example:** [`haikuAgentTraced`](src/workflows.ts#L64-L69) + [`generateTextTraced`](src/activities.ts#L18-L35)

**Activity:**

```typescript
import { wrapAISDK } from "braintrust";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";

const wrappedAI = wrapAISDK(ai);

export async function generateTextTraced(params: {
  modelId: string;
  prompt: string;
  system?: string;
}): Promise<string> {
  const result = await wrappedAI.generateText({
    model: openai(params.modelId),
    system: params.system,
    prompt: params.prompt,
  });
  return result.text;
}
```

**Workflow:**

```typescript
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { generateTextTraced } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

export async function haikuAgentTraced(topic: string): Promise<string> {
  return await generateTextTraced({
    modelId: "gpt-4o-mini",
    prompt: `Write a haiku about ${topic}`,
  });
}
```

**Trace hierarchy:**

```
temporal.workflow.haikuAgentTraced
  └── temporal.activity.generateTextTraced
      └── generateText
          └── doGenerate
              ├── input: { prompt: "...", system: "..." }
              ├── output: { text: "...", finishReason: "stop" }
              ├── metrics: { promptTokens: 15, completionTokens: 20 }
              └── toolCalls: [...]  ← When using tools
```

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

### Running Examples

The easiest way to run this example is using **mise** (recommended):

#### Using Mise (Recommended)

**Terminal 1: Start Server + Worker**

```bash
mise run server
```

This starts both the Temporal server and worker with Braintrust tracing enabled.

**Terminal 2: Run Workflows**

```bash
# PSimple workflows with temporalProvider
mise run workflow-haiku    # Text generation with LLM tracing
mise run workflow-tools    # Function calling with LLM tracing

# Full tracing including tool call details with wrapAISDK
mise run workflow-haiku-traced
mise run workflow-tools-traced
```

**Note:** This example demonstrates **Pattern 2** by default (traced provider is enabled in [worker.ts](src/worker.ts#L34)). For Pattern 1 (no LLM tracing), remove the `wrapAISDKProvider` wrapper.

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
pnpm run workflow:tools

pnpm run workflow:haiku-traced
pnpm run workflow:tools-traced
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
- [Temporal AI SDK Integration](https://github.com/temporalio/samples-typescript/tree/main/ai-sdk)
- [Braintrust Temporal Integration](https://www.braintrust.dev/docs/guides/temporal)

---

## Example Workflows

| Workflow           | Pattern | File                                 | Description                 |
| ------------------ | ------- | ------------------------------------ | --------------------------- |
| `haikuAgent`       | 1 & 2   | [workflows.ts](src/workflows.ts#L21) | Simple text generation      |
| `toolsAgent`       | 1 & 2   | [workflows.ts](src/workflows.ts#L35) | Function calling with tools |
| `haikuAgentTraced` | 3       | [workflows.ts](src/workflows.ts#L64) | Full LLM tracing            |
| `toolsAgentTraced` | 3       | [workflows.ts](src/workflows.ts#L72) | Full tool call tracing      |
