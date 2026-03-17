/**
 * Braintrust integration for Temporal workflows and activities.
 *
 * This module provides a plugin that automatically creates Braintrust spans
 * for Temporal workflows and activities, with proper parent-child relationships
 * across distributed workers.
 *
 * @example
 * ```typescript
 * import { Client, Connection } from "@temporalio/client";
 * import { Worker } from "@temporalio/worker";
 * import * as braintrust from "braintrust";
 * import { createBraintrustTemporalPlugin } from "@braintrust/temporal";
 *
 * // Initialize Braintrust logger
 * braintrust.initLogger({ projectName: "my-project" });
 *
 * // Create the plugin
 * const braintrustPlugin = createBraintrustTemporalPlugin();
 *
 * // Create client with the plugin
 * const client = new Client({
 *   connection: await Connection.connect(),
 *   plugins: [braintrustPlugin],
 * });
 *
 * const workflowsUrl = new URL("./workflows", import.meta.url);
 * const workflowsPath = workflowsUrl.pathname;
 * // Create worker with the plugin
 * const worker = await Worker.create({
 *   taskQueue: "my-queue",
 *   workflowsPath: workflowsPath,
 *   activities,
 *   plugins: [braintrustPlugin],
 * });
 * ```
 *
 * The resulting trace will show:
 * ```
 * trigger-workflow (client span)
 *   └── temporal.workflow.myWorkflow
 *         ├── temporal.activity.activityOne
 *         └── temporal.activity.activityTwo
 * ```
 */

export {
  BraintrustTemporalPlugin,
  createBraintrustTemporalPlugin,
} from "./plugin";

export type { BraintrustSinks } from "./sinks";
