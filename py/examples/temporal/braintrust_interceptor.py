"""Minimal interceptor for Temporal workflows and activities."""

import sys
from typing import Any, Optional, Type

import temporalio.activity
import temporalio.client
import temporalio.worker
import temporalio.workflow


class BraintrustInterceptor(temporalio.client.Interceptor, temporalio.worker.Interceptor):
    """Minimal interceptor that prints when hooks are called."""

    def intercept_client(
        self, next: temporalio.client.OutboundInterceptor
    ) -> temporalio.client.OutboundInterceptor:
        print("here intercept_client", file=sys.stderr, flush=True)
        return _BraintrustClientOutboundInterceptor(next)

    def intercept_activity(
        self, next: temporalio.worker.ActivityInboundInterceptor
    ) -> temporalio.worker.ActivityInboundInterceptor:
        print("here intercept_activity", file=sys.stderr, flush=True)
        return _BraintrustActivityInboundInterceptor(next)

    def workflow_interceptor_class(
        self, input: temporalio.worker.WorkflowInterceptorClassInput
    ) -> Optional[Type["BraintrustWorkflowInboundInterceptor"]]:
        print("here workflow_interceptor_class", file=sys.stderr, flush=True)
        return BraintrustWorkflowInboundInterceptor


class _BraintrustClientOutboundInterceptor(temporalio.client.OutboundInterceptor):
    """Client interceptor."""

    async def start_workflow(
        self, input: temporalio.client.StartWorkflowInput
    ) -> temporalio.client.WorkflowHandle[Any, Any]:
        print(f"here client.start_workflow: {input.workflow}", file=sys.stderr, flush=True)
        return await super().start_workflow(input)


class _BraintrustActivityInboundInterceptor(temporalio.worker.ActivityInboundInterceptor):
    """Activity interceptor."""

    async def execute_activity(
        self, input: temporalio.worker.ExecuteActivityInput
    ) -> Any:
        info = temporalio.activity.info()
        print(f"here activity.execute: {info.activity_type}", file=sys.stderr, flush=True)
        return await super().execute_activity(input)


class BraintrustWorkflowInboundInterceptor(temporalio.worker.WorkflowInboundInterceptor):
    """Workflow interceptor."""

    def init(self, outbound: temporalio.worker.WorkflowOutboundInterceptor) -> None:
        print("here workflow.init")
        super().init(_BraintrustWorkflowOutboundInterceptor(outbound))

    async def execute_workflow(
        self, input: temporalio.worker.ExecuteWorkflowInput
    ) -> Any:
        if not temporalio.workflow.unsafe.is_replaying():
            print(f"here workflow.execute: {input.run_fn.__name__}")
        return await super().execute_workflow(input)


class _BraintrustWorkflowOutboundInterceptor(
    temporalio.worker.WorkflowOutboundInterceptor
):
    """Outbound workflow interceptor."""

    def start_activity(
        self, input: temporalio.worker.StartActivityInput
    ) -> temporalio.workflow.ActivityHandle:
        if not temporalio.workflow.unsafe.is_replaying():
            print(f"here workflow.start_activity: {input.activity}")
        return super().start_activity(input)
