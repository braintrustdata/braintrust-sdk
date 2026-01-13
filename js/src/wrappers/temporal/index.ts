/**
 * Braintrust integration for Temporal workflows and activities.
 *
 * This module provides interceptors and sinks that automatically create
 * Braintrust spans for Temporal workflows and activities, with proper
 * parent-child relationships across distributed workers.
 *
 * @example
 * ```typescript
 * import { Client, Connection } from "@temporalio/client";
 * import { Worker } from "@temporalio/worker";
 * import * as braintrust from "braintrust";
 * import {
 *   createBraintrustClientInterceptor,
 *   createBraintrustActivityInterceptor,
 *   createBraintrustSinks,
 * } from "braintrust/wrappers/temporal";
 *
 * // Initialize Braintrust logger
 * braintrust.initLogger({ projectName: "my-project" });
 *
 * // Create client with Braintrust interceptor
 * const client = new Client({
 *   connection: await Connection.connect(),
 *   interceptors: {
 *     workflow: [createBraintrustClientInterceptor()],
 *   },
 * });
 *
 * // Create worker with Braintrust interceptors and sinks
 * const worker = await Worker.create({
 *   taskQueue: "my-queue",
 *   workflowsPath: require.resolve("./workflows"),
 *   activities,
 *   interceptors: {
 *     activity: [createBraintrustActivityInterceptor],
 *     workflowModules: [require.resolve("braintrust/wrappers/temporal/workflow-interceptors")],
 *   },
 *   sinks: createBraintrustSinks(),
 * });
 *
 * // Start a workflow from within a Braintrust span
 * await braintrust.traced(async (span) => {
 *   const handle = await client.workflow.start("myWorkflow", {
 *     taskQueue: "my-queue",
 *     workflowId: "my-workflow-id",
 *     args: [42],
 *   });
 *   return await handle.result();
 * }, { name: "trigger-workflow" });
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
  createBraintrustClientInterceptor,
  createBraintrustActivityInterceptor,
} from "./interceptors";

export { createBraintrustSinks, getWorkflowSpanExport } from "./sinks";

export type { BraintrustSinks } from "./sinks";

export {
  BRAINTRUST_SPAN_HEADER,
  BRAINTRUST_WORKFLOW_SPAN_HEADER,
} from "./utils";
