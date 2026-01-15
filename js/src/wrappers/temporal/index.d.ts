import type { ClientPlugin, ClientOptions } from "@temporalio/client";
import type { WorkerPlugin, WorkerOptions } from "@temporalio/worker";
import type { Sinks } from "@temporalio/workflow";

/**
 * Braintrust sinks interface for Temporal workflow span management.
 */
export interface BraintrustSinks extends Sinks {
  braintrust: {
    workflowStarted(parentContext?: string, workflowSpanId?: string): void;
    workflowCompleted(error?: string): void;
  };
}

/**
 * A Braintrust plugin for Temporal that automatically instruments
 * workflows and activities with tracing spans.
 *
 * This plugin implements both ClientPlugin and WorkerPlugin interfaces,
 * so it can be used with both Temporal Client and Worker.
 */
export declare class BraintrustTemporalPlugin
  implements ClientPlugin, WorkerPlugin
{
  get name(): string;

  /**
   * Configure the Temporal Client with Braintrust interceptors.
   */
  configureClient(
    options: Omit<ClientOptions, "plugins">,
  ): Omit<ClientOptions, "plugins">;

  /**
   * Configure the Temporal Worker with Braintrust interceptors and sinks.
   */
  configureWorker(options: WorkerOptions): WorkerOptions;
}

/**
 * Create a Braintrust plugin for Temporal.
 */
export declare function createBraintrustTemporalPlugin(): BraintrustTemporalPlugin;
