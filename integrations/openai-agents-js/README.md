# @braintrust/openai-agents

SDK for integrating Braintrust with OpenAI Agents.

## Installation

```bash
npm install braintrust @braintrust/openai-agents @openai/agents
```

## Usage

```typescript
import { initLogger } from "braintrust";
import { OpenAIAgentsTraceProcessor } from "@braintrust/openai-agents";
import { Agent, run, addTraceProcessor } from "@openai/agents";

// Initialize Braintrust logger
const logger = initLogger({
  projectName: "my-agents-project",
});

// Create the tracing processor
const processor = new OpenAIAgentsTraceProcessor({ logger });

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

### `OpenAIAgentsTraceProcessor`

A tracing processor that logs traces from the OpenAI Agents SDK to Braintrust.

#### Constructor

```typescript
new OpenAIAgentsTraceProcessor(options?: OpenAIAgentsTraceProcessorOptions)
```

**Options:**

- `logger?: Logger` - A Braintrust `Span`, `Experiment`, or `Logger` to use for logging. If undefined, the current span, experiment, or logger will be selected exactly as in `startSpan`.
- `maxTraces?: number` - Maximum number of concurrent traces to keep in memory (default: 10000). When exceeded, oldest traces are evicted using LRU policy to prevent memory leaks.
