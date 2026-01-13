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
 * import { createBraintrustTemporalPlugin } from "braintrust/wrappers/temporal";
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
 * // Create worker with the plugin
 * const worker = await Worker.create({
 *   taskQueue: "my-queue",
 *   workflowsPath: require.resolve("./workflows"),
 *   activities,
 *   plugins: [braintrustPlugin],
 *   interceptors: {
 *     // Workflow interceptors must be bundled with workflow code
 *     workflowModules: [require.resolve("braintrust/temporal/workflow-interceptors")],
 *   },
 * });
 *
 * // In your workflows.ts, export the workflow interceptors:
 * export { interceptors } from "braintrust/wrappers/temporal/workflow-interceptors";
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
