# Temporal + Braintrust Tracing Example

This example demonstrates how to integrate Braintrust tracing with Temporal workflows and activities.

## Prerequisites

- [mise](https://mise.jdx.dev/) (recommended) - automatically installs all dependencies
- OR manually install:
  - Node.js 20+
  - `pnpm`
  - Temporal CLI (`temporal`)
  - Optional: [`overmind`](https://github.com/DarthSim/overmind) (only if you want to use the included `Procfile`)

### Option 1: Using mise (recommended)

[mise](https://mise.jdx.dev/) will automatically install and manage all required tools (Node.js, Temporal CLI, overmind, and dependencies):

**Install mise:**

```bash
# macOS/Linux
curl https://mise.run | sh

# Or using Homebrew
brew install mise
```

**Setup and run:**

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your BRAINTRUST_API_KEY

# mise will automatically install tools and dependencies
mise run server  # Start temporal server and workers

# In another terminal:
mise run workflow  # Run the workflow client
```

**Available mise tasks:**

```bash
mise run install   # Install dependencies
mise run server    # Run temporal server and workers
mise run workflow  # Run workflow client
mise run stop      # Stop temporal server and workers
mise run kill      # Force kill all processes
```

### Option 2: Manual installation

#### Installing Temporal CLI

The Temporal CLI is required to run the local Temporal server:

**macOS:**

```bash
brew install temporal
```

**Linux:**

```bash
# Using Homebrew
brew install temporal

# Or using curl
curl -sSf https://temporal.download/cli.sh | sh
```

**Windows:**

```powershell
# Using Scoop
scoop install temporal

# Or download from releases
# https://github.com/temporalio/cli/releases
```

Verify the installation:

```bash
temporal --version
```

#### Installing overmind (optional)

Overmind is a process manager that makes it easy to run multiple services together. If you want to use `overmind start` to run everything at once, install it for your platform:

**macOS:**

```bash
brew install overmind
```

**Linux:**

```bash
brew install overmind

# Or download from releases
# https://github.com/DarthSim/overmind/releases
```

**Windows:**
Overmind is not officially supported on Windows. Use the manual approach below instead.

## Setup

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your BRAINTRUST_API_KEY

# Install dependencies
pnpm install
```

## Running the Example

### Option 1: Using overmind

Start the temporal server and workers together:

```bash
overmind start
```

Then in another terminal, run the workflow:

```bash
pnpm run client
```

### Option 2: Manual

1. Start the Temporal server:

```bash
temporal server start-dev
```

2. Start the worker:

```bash
pnpm run worker
```

3. Run the client:

```bash
pnpm run client

# Or with a signal:
pnpm run client -- --signal
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
