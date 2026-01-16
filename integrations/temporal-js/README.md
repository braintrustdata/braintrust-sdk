# @braintrust/temporal

SDK for integrating [Braintrust](https://braintrust.dev) tracing with [Temporal](https://temporal.io/) workflows and activities.

## Installation

This package has peer dependencies that you must install alongside it:

```bash
npm install @braintrust/temporal braintrust @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/common
# or
yarn add @braintrust/temporal braintrust @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/common
# or
pnpm add @braintrust/temporal braintrust @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/common
```

## Usage

Initialize Braintrust, then install the plugin on both the Temporal client and worker.

```typescript
import { Client, Connection } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import * as braintrust from "braintrust";
import { BraintrustTemporalPlugin } from "@braintrust/temporal";

braintrust.initLogger({ projectName: "my-project" });

const plugin = new BraintrustTemporalPlugin();

const client = new Client({
  connection: await Connection.connect(),
  plugins: [plugin],
});

const worker = await Worker.create({
  taskQueue: "my-queue",
  workflowsPath: require.resolve("./workflows"),
  activities,
  plugins: [plugin],
});
```

## Workflow interceptors

This package also exports workflow interceptors that are loaded into the Temporal workflow isolate:

- `@braintrust/temporal/workflow-interceptors`

The `BraintrustTemporalPlugin` automatically configures `workflowModules` to include these interceptors when used on a worker.

## Example

See the example app in `examples/temporal`.
