import type {
  ClientPlugin,
  ClientOptions,
  WorkflowClientInterceptor,
  WorkflowClientInterceptors,
  WorkflowClientCallsInterceptorFactory,
} from "@temporalio/client";
import type { WorkerPlugin, WorkerOptions } from "@temporalio/worker";
import {
  createBraintrustClientInterceptor,
  createBraintrustActivityInterceptor,
} from "./interceptors";
import { createBraintrustSinks } from "./sinks";

// Add the workflow interceptor package specifier so the Temporal bundler can include it
const WORKFLOW_INTERCEPTORS_SPEC = "@braintrust/temporal/workflow-interceptors";

/**
 * A Braintrust plugin for Temporal that automatically instruments
 * workflows and activities with tracing spans.
 *
 * This plugin implements both ClientPlugin and WorkerPlugin interfaces,
 * so it can be used with both Temporal Client and Worker.
 *
 * @example
 * ```typescript
 * import { Client, Connection } from "@temporalio/client";
 * import { Worker } from "@temporalio/worker";
 * import * as braintrust from "braintrust";
 * import { BraintrustTemporalPlugin } from "@braintrust/temporal";
 *
 * // Initialize Braintrust logger
 * braintrust.initLogger({ projectName: "my-project" });
 *
 * // Create client with the plugin
 * const client = new Client({
 *   connection: await Connection.connect(),
 *   plugins: [new BraintrustTemporalPlugin()],
 * });
 *
 * // Create worker with the plugin
 * const worker = await Worker.create({
 *   taskQueue: "my-queue",
 *   workflowsPath: require.resolve("./workflows"),
 *   activities,
 *   plugins: [new BraintrustTemporalPlugin()],
 * });
 * ```
 */
export class BraintrustTemporalPlugin implements ClientPlugin, WorkerPlugin {
  get name(): string {
    return "braintrust";
  }

  /**
   * Configure the Temporal Client with Braintrust interceptors.
   * Adds the client interceptor for propagating span context to workflows.
   */
  configureClient(
    options: Omit<ClientOptions, "plugins">,
  ): Omit<ClientOptions, "plugins"> {
    const existing = options.interceptors?.workflow;
    const braintrustInterceptor = createBraintrustClientInterceptor();

    let workflow:
      | WorkflowClientInterceptors
      | WorkflowClientInterceptor[]
      | undefined;

    if (Array.isArray(existing)) {
      workflow = [
        ...(existing as WorkflowClientInterceptor[]),
        braintrustInterceptor,
      ];
    } else if (existing) {
      // It's a WorkflowClientInterceptors object, merge our interceptor into the calls array
      workflow = {
        ...existing,
        calls: [...(existing.calls ?? []), () => braintrustInterceptor],
      };
    } else {
      // keep in new array form
      workflow = [braintrustInterceptor];
    }

    return {
      ...options,
      interceptors: {
        ...options.interceptors,
        workflow,
      },
    } as Omit<ClientOptions, "plugins">;
  }

  /**
   * Configure the Temporal Worker with Braintrust interceptors and sinks.
   * Adds the activity interceptor for creating spans, the sinks for workflow spans,
   * and the workflow interceptor modules for bundling.
   */
  configureWorker(options: WorkerOptions): WorkerOptions {
    const existingActivityInterceptors = options.interceptors?.activity ?? [];
    const existingWorkflowModules = options.interceptors?.workflowModules ?? [];
    const existingSinks = options.sinks ?? {};

    const braintrustSinks = createBraintrustSinks();

    const workflowModules = [
      ...new Set([...existingWorkflowModules, WORKFLOW_INTERCEPTORS_SPEC]),
    ];

    const activityFactories = [
      ...new Set([
        ...existingActivityInterceptors,
        createBraintrustActivityInterceptor,
      ]),
    ];

    const result: WorkerOptions = {
      ...options,
      interceptors: {
        ...options.interceptors,
        activity: activityFactories,
        workflowModules,
      },
      sinks: {
        ...existingSinks,
        ...braintrustSinks,
      },
    };

    return result;
  }
}

/**
 * Create a Braintrust plugin for Temporal.
 *
 * @example
 * ```typescript
 * const plugin = createBraintrustTemporalPlugin();
 *
 * const client = new Client({ plugins: [plugin] });
 * const worker = await Worker.create({ plugins: [plugin], ... });
 * ```
 */
export function createBraintrustTemporalPlugin(): BraintrustTemporalPlugin {
  return new BraintrustTemporalPlugin();
}
