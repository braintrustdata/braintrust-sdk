# @braintrust/openai-agents

SDK for integrating Braintrust with OpenAI Agents.

## Installation

```bash
npm install braintrust @braintrust/openai-agents @openai/agents
```

## Usage

```typescript
import { initLogger } from "braintrust";
import { OpenAIAgentsTracingProcessor } from "@braintrust/openai-agents";
import { Agent, run, addTraceProcessor } from "@openai/agents";

// Initialize Braintrust logger
const logger = initLogger({
  projectName: "my-agents-project",
});

// Create the tracing processor
const processor = new OpenAIAgentsTracingProcessor({ logger });

// Add the processor to OpenAI Agents
addTraceProcessor(processor);

// Create and run your agent
const agent = new Agent({
  name: "my-agent",
  model: "gpt-4o-mini",
  instructions: "You are a helpful assistant.",
});

const result = await run(agent, "Hello, world!");
```

## API

### `OpenAIAgentsTracingProcessor`

A tracing processor that logs traces from the OpenAI Agents SDK to Braintrust.

#### Constructor

```typescript
new OpenAIAgentsTracingProcessor(options?: OpenAIAgentsTracingProcessorOptions)
```

**Options:**

- `logger?: Logger` - A Braintrust `Span`, `Experiment`, or `Logger` to use for logging. If undefined, the current span, experiment, or logger will be selected exactly as in `startSpan`.
- `maxTraces?: number` - Maximum number of concurrent traces to keep in memory (default: 1000). When exceeded, oldest traces are evicted using LRU policy to prevent memory leaks.

#### Methods

- `onTraceStart(trace)`: Called when a trace starts
- `onTraceEnd(trace)`: Called when a trace ends
- `onSpanStart(span)`: Called when a span starts
- `onSpanEnd(span)`: Called when a span ends
- `shutdown()`: Shut down the processor
- `forceFlush()`: Force flush any pending data
