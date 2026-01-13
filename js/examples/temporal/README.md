# Temporal + Braintrust Tracing Example

This example demonstrates how to integrate Braintrust tracing with Temporal workflows and activities.

## Prerequisites

- [mise](https://mise.jdx.dev/) installed

## Setup

```bash
# Install tools (node, temporal, overmind)
mise install

# Copy and configure environment
cp .env.example .env
# Edit .env with your BRAINTRUST_API_KEY
```

## Running the Example

### Option 1: Using overmind (recommended)

Start the temporal server and workers together:

```bash
mise run server
```

Then in another terminal, run the workflow:

```bash
mise run workflow
```

### Option 2: Manual

1. Start the Temporal server:

```bash
temporal server start-dev
```

2. Start the worker:

```bash
npm run worker
```

3. Run the client:

```bash
npm run client

# Or with a signal:
npm run client -- --signal
```

## What Gets Traced

- **Client span**: Wraps the workflow execution call
- **Workflow span**: Created via sinks when the workflow starts
- **Activity spans**: Created for each activity execution with parent linking

The trace hierarchy looks like:

```
Client span ("example.temporal.workflow")
  └── Workflow span ("temporal.workflow.simpleWorkflow")
        └── Activity span ("temporal.activity.addTen")
        └── Activity span ("temporal.activity.multiplyByTwo")
        └── Activity span ("temporal.activity.subtractFive")
```

## How It Works

1. **Client interceptor**: Captures the current Braintrust span context and adds it to workflow headers
2. **Workflow interceptor**: Extracts parent context from headers and creates a workflow span via sinks
3. **Sinks**: Allow the workflow isolate to call into Node.js to create spans (with `callDuringReplay: false`)
4. **Activity interceptor**: Creates spans for each activity, using the workflow span as parent
