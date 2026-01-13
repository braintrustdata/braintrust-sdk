import type { ClientPlugin, ClientOptions } from "@temporalio/client";
import type { WorkerPlugin, WorkerOptions } from "@temporalio/worker";
import {
  createBraintrustClientInterceptor,
  createBraintrustActivityInterceptor,
} from "./interceptors";
import { createBraintrustSinks } from "./sinks";

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
 * import { BraintrustTemporalPlugin } from "braintrust";
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

    // workflow can be an array or an object with named interceptors
    let workflow: typeof existing;
    if (Array.isArray(existing)) {
      workflow = [...existing, braintrustInterceptor];
    } else if (existing) {
      // It's a WorkflowClientInterceptors object, merge our interceptor
      workflow = {
        ...existing,
        ...braintrustInterceptor,
      };
    } else {
      workflow = [braintrustInterceptor];
    }

    return {
      ...options,
      interceptors: {
        ...options.interceptors,
        workflow,
      },
    };
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

    // Resolve the workflow interceptors module path
    // This needs to be resolved at runtime to get the actual file path
    const workflowInterceptorsPath = require.resolve(
      "braintrust/temporal/workflow-interceptors",
    );

    return {
      ...options,
      interceptors: {
        ...options.interceptors,
        activity: [
          ...existingActivityInterceptors,
          createBraintrustActivityInterceptor,
        ],
        workflowModules: [...existingWorkflowModules, workflowInterceptorsPath],
      },
      sinks: {
        ...existingSinks,
        ...braintrustSinks,
      },
    };
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
