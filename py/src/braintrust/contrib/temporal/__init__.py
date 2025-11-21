"""Braintrust interceptor for Temporal workflows and activities.

This module provides Temporal interceptors that automatically trace workflow executions
and activities in Braintrust. To use this integration, install braintrust with the
temporal extra:

    pip install braintrust[temporal]

Example usage:

    import braintrust
    from braintrust.contrib.temporal import BraintrustInterceptor
    from temporalio.client import Client
    from temporalio.worker import Worker

    # Initialize Braintrust logger
    braintrust.init_logger(project="my-project")

    # Create Temporal client with Braintrust interceptor
    client = await Client.connect(
        "localhost:7233",
        interceptors=[BraintrustInterceptor()],
    )

    # Create worker with Braintrust interceptor
    worker = Worker(
        client,
        task_queue="my-queue",
        workflows=[MyWorkflow],
        activities=[my_activity],
        interceptors=[BraintrustInterceptor()],
    )

The interceptor will automatically:
- Trace workflow executions
- Trace all activity executions
- Trace local activities
- Maintain parent-child relationships between client calls, workflows, and activities
- Handle child workflows
- Respect Temporal replay safety (no duplicate spans during replay)
"""

from typing import Any, Dict, Mapping, Optional, Type

import braintrust
import temporalio.activity
import temporalio.api.common.v1
import temporalio.client
import temporalio.converter
import temporalio.worker
import temporalio.workflow

# Braintrust dynamically chooses its context implementation at runtime based on
# BRAINTRUST_OTEL_COMPAT environment variable. When first accessed, it reads
# os.environ which is restricted in the sandbox. Therefore if the first use
# is inside the sandbox, it will fail. So we eagerly reference it here to
# force initialization at import time (before sandbox evaluation).
try:
    braintrust.current_span()
except Exception:
    # It's okay if this fails (e.g., no logger initialized yet)
    pass

# Store module-level reference to braintrust.current_span to avoid re-importing
# inside extern functions (which can trigger sandbox restrictions)
_current_span = braintrust.current_span

# Header key for passing span context between client, workflows, and activities
_HEADER_KEY = "_braintrust-span"


class BraintrustInterceptor(temporalio.client.Interceptor, temporalio.worker.Interceptor):
    """Braintrust interceptor for tracing Temporal workflows and activities.

    This interceptor can be used with both Temporal clients and workers to automatically
    trace workflow executions and activity runs. It maintains proper parent-child
    relationships in the trace hierarchy and respects Temporal's replay safety requirements.

    The interceptor:
    - Creates spans for workflow executions (using sandbox_unrestricted)
    - Captures activity execution as spans with metadata
    - Propagates span context from client → workflow → activities
    - Handles both regular activities and local activities
    - Supports child workflows
    - Logs errors from failed activities and workflows
    - Ensures replay safety (no duplicate spans during workflow replay)
    """

    def __init__(self) -> None:
        """Initialize interceptor."""
        self.payload_converter = temporalio.converter.PayloadConverter.default

    def intercept_client(
        self, next: temporalio.client.OutboundInterceptor
    ) -> temporalio.client.OutboundInterceptor:
        """Intercept client calls to propagate span context to workflows."""
        return _BraintrustClientOutboundInterceptor(next, self)

    def intercept_activity(
        self, next: temporalio.worker.ActivityInboundInterceptor
    ) -> temporalio.worker.ActivityInboundInterceptor:
        """Intercept activity executions to create activity spans."""
        return _BraintrustActivityInboundInterceptor(next, self)

    def workflow_interceptor_class(
        self, input: temporalio.worker.WorkflowInterceptorClassInput
    ) -> Optional[Type["BraintrustWorkflowInboundInterceptor"]]:
        """Return workflow interceptor class to propagate context to activities."""
        return BraintrustWorkflowInboundInterceptor

    def _span_context_to_headers(
        self,
        span_context: Dict[str, Any],
        headers: Mapping[str, temporalio.api.common.v1.Payload],
    ) -> Mapping[str, temporalio.api.common.v1.Payload]:
        """Add span context to headers."""
        if span_context:
            payloads = self.payload_converter.to_payloads([span_context])
            if payloads:
                headers = {
                    **headers,
                    _HEADER_KEY: payloads[0],
                }
        return headers

    def _span_context_from_headers(
        self, headers: Mapping[str, temporalio.api.common.v1.Payload]
    ) -> Optional[Dict[str, Any]]:
        """Extract span context from headers."""
        if _HEADER_KEY not in headers:
            return None
        header_payload = headers.get(_HEADER_KEY)
        if not header_payload:
            return None
        payloads = self.payload_converter.from_payloads([header_payload])
        if not payloads:
            return None
        return payloads[0] if payloads[0] else None


class _BraintrustClientOutboundInterceptor(temporalio.client.OutboundInterceptor):
    """Client interceptor that propagates span context to workflows."""

    def __init__(
        self, next: temporalio.client.OutboundInterceptor, root: BraintrustInterceptor
    ) -> None:
        super().__init__(next)
        self.root = root

    async def start_workflow(
        self, input: temporalio.client.StartWorkflowInput
    ) -> temporalio.client.WorkflowHandle[Any, Any]:
        # Get current span context and add it to workflow headers
        current_span = _current_span()
        if current_span:
            span_context = current_span.export()
            input.headers = self.root._span_context_to_headers(span_context, input.headers)

        return await super().start_workflow(input)


class _BraintrustActivityInboundInterceptor(temporalio.worker.ActivityInboundInterceptor):
    """Activity interceptor that creates spans for activity executions."""

    def __init__(
        self,
        next: temporalio.worker.ActivityInboundInterceptor,
        root: BraintrustInterceptor,
    ) -> None:
        super().__init__(next)
        self.root = root

    async def execute_activity(
        self, input: temporalio.worker.ExecuteActivityInput
    ) -> Any:
        info = temporalio.activity.info()

        # Extract parent span context from headers
        parent_span_context = self.root._span_context_from_headers(input.headers)

        # Create Braintrust span for activity execution, linked to workflow span
        span = braintrust.start_span(
            name=f"temporal.activity.{info.activity_type}",
            type="task",
            parent=parent_span_context or None,
        )
        span.set_current()

        # Log activity metadata
        span.log(
            metadata={
                "temporal.activity_type": info.activity_type,
                "temporal.activity_id": info.activity_id,
                "temporal.workflow_id": info.workflow_id,
                "temporal.workflow_run_id": info.workflow_run_id,
            },
        )

        try:
            result = await super().execute_activity(input)
            return result
        except Exception as e:
            span.log(error=str(e))
            raise
        finally:
            span.unset_current()
            span.end()


class BraintrustWorkflowInboundInterceptor(temporalio.worker.WorkflowInboundInterceptor):
    """Workflow interceptor that creates workflow spans and propagates context to activities.

    This interceptor creates a span for the workflow execution using sandbox_unrestricted
    to bypass Temporal's sandbox restrictions. The workflow span is the parent for all
    activities and child workflows executed within it.
    """

    def __init__(self, next: temporalio.worker.WorkflowInboundInterceptor) -> None:
        super().__init__(next)
        self.payload_converter = temporalio.converter.PayloadConverter.default
        self._parent_span_context: Optional[Dict[str, Any]] = None

    def init(self, outbound: temporalio.worker.WorkflowOutboundInterceptor) -> None:
        super().init(_BraintrustWorkflowOutboundInterceptor(outbound, self))

    async def execute_workflow(
        self, input: temporalio.worker.ExecuteWorkflowInput
    ) -> Any:
        # Extract parent span context from workflow headers (set by client)
        parent_span_context = None
        if _HEADER_KEY in input.headers:
            header_payload = input.headers.get(_HEADER_KEY)
            if header_payload:
                payloads = self.payload_converter.from_payloads([header_payload])
                if payloads:
                    parent_span_context = payloads[0]

        # Store parent span context for activities (will be overwritten if we create a workflow span)
        self._parent_span_context = parent_span_context

        # Create a span for the workflow execution using sandbox_unrestricted
        # to bypass the sandbox restrictions on logger state access
        span = None
        if not temporalio.workflow.unsafe.is_replaying():
            with temporalio.workflow.unsafe.sandbox_unrestricted():
                span = braintrust.start_span(
                    name=f"temporal.workflow.{temporalio.workflow.info().workflow_type}",
                    type="task",
                    parent=parent_span_context or None,
                )
                span.set_current()

                # Log workflow metadata
                info = temporalio.workflow.info()
                span.log(
                    metadata={
                        "temporal.workflow_type": info.workflow_type,
                        "temporal.workflow_id": info.workflow_id,
                        "temporal.run_id": info.run_id,
                    },
                )

                # Store the workflow span context for activities
                self._parent_span_context = span.export()

        try:
            result = await super().execute_workflow(input)
            return result
        except Exception as e:
            if span:
                with temporalio.workflow.unsafe.sandbox_unrestricted():
                    span.log(error=str(e))
            raise
        finally:
            if span:
                with temporalio.workflow.unsafe.sandbox_unrestricted():
                    span.unset_current()
                    span.end()


class _BraintrustWorkflowOutboundInterceptor(
    temporalio.worker.WorkflowOutboundInterceptor
):
    """Outbound workflow interceptor that propagates span context to activities."""

    def __init__(
        self,
        next: temporalio.worker.WorkflowOutboundInterceptor,
        root: BraintrustWorkflowInboundInterceptor,
    ) -> None:
        super().__init__(next)
        self.root = root

    def _add_span_context_to_headers(
        self, headers: Mapping[str, temporalio.api.common.v1.Payload]
    ) -> Mapping[str, temporalio.api.common.v1.Payload]:
        """Add parent span context to headers if available.

        Note: We always pass span context through headers, even during replay,
        so activities can maintain proper parent-child relationships. The replay
        safety is handled in the activity interceptor, which only creates spans
        when the activity actually executes (not during replay).
        """
        if self.root._parent_span_context:
            payloads = self.root.payload_converter.to_payloads([self.root._parent_span_context])
            if payloads:
                return {**headers, _HEADER_KEY: payloads[0]}
        return headers

    def start_activity(
        self, input: temporalio.worker.StartActivityInput
    ) -> temporalio.workflow.ActivityHandle:
        input.headers = self._add_span_context_to_headers(input.headers)
        return super().start_activity(input)

    def start_local_activity(
        self, input: temporalio.worker.StartLocalActivityInput
    ) -> temporalio.workflow.ActivityHandle:
        input.headers = self._add_span_context_to_headers(input.headers)
        return super().start_local_activity(input)

    def start_child_workflow(
        self, input: temporalio.worker.StartChildWorkflowInput
    ) -> temporalio.workflow.ChildWorkflowHandle:
        input.headers = self._add_span_context_to_headers(input.headers)
        return super().start_child_workflow(input)


__all__ = ["BraintrustInterceptor"]
