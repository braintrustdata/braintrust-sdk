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
  serializeHeaderValue,
  deserializeHeaderValue,
} from "./utils";

const { braintrust } = proxySinks<BraintrustSinks>();

// Store info for propagation to activities
let storedParentContext: string | undefined;
let workflowSpanId: string | undefined;

class BraintrustWorkflowInboundInterceptor
  implements WorkflowInboundCallsInterceptor
{
  async execute(
    input: WorkflowExecuteInput,
    next: Next<WorkflowInboundCallsInterceptor, "execute">,
  ): Promise<unknown> {
    const info = workflowInfo();

    // Extract parent context from headers
    const parentContext = input.headers
      ? deserializeHeaderValue(input.headers[BRAINTRUST_SPAN_HEADER])
      : undefined;

    // Store for the outbound interceptor to forward to activities
    storedParentContext = parentContext;

    // Generate a deterministic spanId for the workflow span
    workflowSpanId = uuid4();

    // Create workflow span via sink (only called if not replaying)
    // NOTE: WorkflowInfo is injected automatically by the runtime
    braintrust.workflowStarted(parentContext, workflowSpanId);

    try {
      const result = await next(input);
      braintrust.workflowCompleted();
      return result;
    } catch (e) {
      braintrust.workflowCompleted(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      storedParentContext = undefined;
      workflowSpanId = undefined;
    }
  }
}

class BraintrustWorkflowOutboundInterceptor
  implements WorkflowOutboundCallsInterceptor
{
  private getHeaders(): Record<string, Payload> {
    const info = workflowInfo();
    const headers: Record<string, Payload> = {};

    // Pass runId so activity can look up workflow span on same worker
    headers[BRAINTRUST_WORKFLOW_SPAN_HEADER] = serializeHeaderValue(info.runId);

    // Pass parent context (client span) as fallback for cross-worker activities
    if (storedParentContext) {
      headers[BRAINTRUST_SPAN_HEADER] =
        serializeHeaderValue(storedParentContext);
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

export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new BraintrustWorkflowInboundInterceptor()],
  outbound: [new BraintrustWorkflowOutboundInterceptor()],
});
