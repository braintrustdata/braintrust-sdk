import type { Context } from "@temporalio/activity";
import type {
  ActivityInboundCallsInterceptor,
  ActivityExecuteInput,
  Next,
  ActivityInterceptors,
} from "@temporalio/worker";
import type { WorkflowClientInterceptor } from "@temporalio/client";
import { defaultPayloadConverter } from "@temporalio/common";
import * as braintrust from "../../logger";
import { getWorkflowSpanExport } from "./sinks";
import { BRAINTRUST_SPAN_HEADER, deserializeHeaderValue } from "./utils";

/**
 * Create a client interceptor that propagates Braintrust span context to workflows.
 * Use this when creating a Temporal Client to enable trace context propagation.
 */
export function createBraintrustClientInterceptor(): WorkflowClientInterceptor {
  return {
    async start(input, next) {
      const span = braintrust.currentSpan();
      if (span) {
        const exported = await span.export();
        if (exported) {
          const payload = defaultPayloadConverter.toPayload(exported);
          if (payload) {
            return next({
              ...input,
              headers: {
                ...input.headers,
                [BRAINTRUST_SPAN_HEADER]: payload,
              },
            });
          }
        }
      }
      return next(input);
    },
    async signal(input, next) {
      return next(input);
    },
    async signalWithStart(input, next) {
      const span = braintrust.currentSpan();
      if (span) {
        const exported = await span.export();
        if (exported) {
          const payload = defaultPayloadConverter.toPayload(exported);
          if (payload) {
            return next({
              ...input,
              headers: {
                ...input.headers,
                [BRAINTRUST_SPAN_HEADER]: payload,
              },
            });
          }
        }
      }
      return next(input);
    },
  };
}

/**
 * Activity interceptor that creates Braintrust spans for activity executions.
 */
class BraintrustActivityInterceptor implements ActivityInboundCallsInterceptor {
  constructor(private ctx: Context) {}

  async execute(
    input: ActivityExecuteInput,
    next: Next<ActivityInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    const info = this.ctx.info;
    const runId = info.workflowExecution.runId;

    // Try to get workflow span export - first check local Map, then headers
    let parent: string | undefined;

    // Check if we have the workflow span export locally (same worker as workflow)
    const spanExportPromise = getWorkflowSpanExport(runId);
    if (spanExportPromise) {
      try {
        parent = await spanExportPromise;
      } catch {
        // Ignore errors, fall through to header check
      }
    }

    // Fall back to original client context from headers
    if (!parent && input.headers && BRAINTRUST_SPAN_HEADER in input.headers) {
      parent = deserializeHeaderValue(input.headers[BRAINTRUST_SPAN_HEADER]);
    }

    const span = braintrust.startSpan({
      name: `temporal.activity.${info.activityType}`,
      spanAttributes: { type: "task" },
      parent,
      event: {
        metadata: {
          "temporal.activity_type": info.activityType,
          "temporal.activity_id": info.activityId,
          "temporal.workflow_id": info.workflowExecution.workflowId,
          "temporal.workflow_run_id": runId,
        },
      },
    });

    try {
      const result = await braintrust.withCurrent(span, () => next(input));
      span.log({ output: result });
      span.end();
      return result;
    } catch (e) {
      span.log({ error: String(e) });
      span.end();
      throw e;
    }
  }
}

/**
 * Create an activity interceptor factory for use with Worker.create().
 * This factory creates BraintrustActivityInterceptor instances for each activity.
 */
export function createBraintrustActivityInterceptor(
  ctx: Context,
): ActivityInterceptors {
  return {
    inbound: new BraintrustActivityInterceptor(ctx),
  };
}
