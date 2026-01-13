/**
 * Workflow interceptors for Braintrust tracing.
 *
 * IMPORTANT: This module is loaded into the Temporal workflow isolate.
 * It cannot import Node.js modules or access external state directly.
 * Communication with the outside world is done via sinks.
 */
import {
  WorkflowInterceptorsFactory,
  WorkflowInboundCallsInterceptor,
  WorkflowOutboundCallsInterceptor,
  WorkflowExecuteInput,
  Next,
  proxySinks,
  workflowInfo,
  uuid4,
} from "@temporalio/workflow";
import type {
  ActivityInput,
  LocalActivityInput,
  StartChildWorkflowExecutionInput,
} from "@temporalio/workflow";
import type { Payload } from "@temporalio/common";
import type { BraintrustSinks } from "./sinks";
import {
  BRAINTRUST_SPAN_HEADER,
  BRAINTRUST_WORKFLOW_SPAN_HEADER,
  BRAINTRUST_WORKFLOW_SPAN_ID_HEADER,
  serializeHeaderValue,
  deserializeHeaderValue,
} from "./utils";

const { braintrust } = proxySinks<BraintrustSinks>();

/**
 * Shared state between inbound and outbound interceptors for a single workflow.
 * Created per-workflow by the factory function to avoid global state issues.
 */
interface WorkflowSpanState {
  parentContext: string | undefined;
  spanId: string | undefined;
}

class BraintrustWorkflowInboundInterceptor
  implements WorkflowInboundCallsInterceptor
{
  constructor(private state: WorkflowSpanState) {}

  async execute(
    input: WorkflowExecuteInput,
    next: Next<WorkflowInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    // Extract parent context from headers
    const parentContext = input.headers
      ? deserializeHeaderValue(input.headers[BRAINTRUST_SPAN_HEADER])
      : undefined;

    // Store for the outbound interceptor to forward to activities
    this.state.parentContext = parentContext;

    // Generate a deterministic spanId for the workflow span
    this.state.spanId = uuid4();

    // Create workflow span via sink (only called if not replaying)
    // NOTE: WorkflowInfo is injected automatically by the runtime
    braintrust.workflowStarted(parentContext, this.state.spanId);

    try {
      const result = await next(input);
      braintrust.workflowCompleted();
      return result;
    } catch (e) {
      braintrust.workflowCompleted(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }
}

class BraintrustWorkflowOutboundInterceptor
  implements WorkflowOutboundCallsInterceptor
{
  constructor(private state: WorkflowSpanState) {}

  private getHeaders(): Record<string, Payload> {
    const info = workflowInfo();
    const headers: Record<string, Payload> = {};

    // Pass runId so activity can look up workflow span on same worker
    headers[BRAINTRUST_WORKFLOW_SPAN_HEADER] = serializeHeaderValue(info.runId);

    // Pass workflow span ID for cross-worker activities to construct parent
    if (this.state.spanId) {
      headers[BRAINTRUST_WORKFLOW_SPAN_ID_HEADER] = serializeHeaderValue(
        this.state.spanId,
      );
    }

    // Pass client context for cross-worker activities to construct parent
    if (this.state.parentContext) {
      headers[BRAINTRUST_SPAN_HEADER] = serializeHeaderValue(
        this.state.parentContext,
      );
    }

    return headers;
  }

  scheduleActivity(
    input: ActivityInput,
    next: Next<WorkflowOutboundCallsInterceptor, "scheduleActivity">,
  ) {
    return next({
      ...input,
      headers: {
        ...input.headers,
        ...this.getHeaders(),
      },
    });
  }

  scheduleLocalActivity(
    input: LocalActivityInput,
    next: Next<WorkflowOutboundCallsInterceptor, "scheduleLocalActivity">,
  ) {
    return next({
      ...input,
      headers: {
        ...input.headers,
        ...this.getHeaders(),
      },
    });
  }

  startChildWorkflowExecution(
    input: StartChildWorkflowExecutionInput,
    next: Next<WorkflowOutboundCallsInterceptor, "startChildWorkflowExecution">,
  ) {
    return next({
      ...input,
      headers: {
        ...input.headers,
        ...this.getHeaders(),
      },
    });
  }
}

export const interceptors: WorkflowInterceptorsFactory = () => {
  // Create shared state for this workflow instance
  const state: WorkflowSpanState = {
    parentContext: undefined,
    spanId: undefined,
  };

  return {
    inbound: [new BraintrustWorkflowInboundInterceptor(state)],
    outbound: [new BraintrustWorkflowOutboundInterceptor(state)],
  };
};
