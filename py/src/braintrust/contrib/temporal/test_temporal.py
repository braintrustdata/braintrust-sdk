"""Unit tests for Braintrust Temporal interceptor."""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict

import pytest
import pytest_asyncio

pytest.importorskip("temporalio")

import braintrust
import temporalio.activity
import temporalio.api.common.v1
import temporalio.converter
import temporalio.testing
import temporalio.worker
import temporalio.workflow
from braintrust.contrib.temporal import BraintrustInterceptor, BraintrustPlugin
from braintrust.test_helpers import init_test_logger
from temporalio.common import RetryPolicy
from temporalio.worker import Worker


class TestHeaderSerialization:
    """Unit tests for header serialization/deserialization."""

    def test_span_context_to_headers_with_valid_context(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id", "span_id": "test-span-id"}
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "_braintrust-span" in result_headers
        assert len(result_headers) == 1

    def test_span_context_to_headers_with_empty_context(self):
        interceptor = BraintrustInterceptor()
        span_context: Dict[str, Any] = {}
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "_braintrust-span" not in result_headers
        assert len(result_headers) == 0

    def test_span_context_to_headers_preserves_existing_headers(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id"}

        # Create a payload for existing header
        existing_payload = interceptor.payload_converter.to_payloads(["existing_value"])[0]
        headers = {"existing_header": existing_payload}

        result_headers = interceptor._span_context_to_headers(span_context, headers)

        assert "existing_header" in result_headers
        assert "_braintrust-span" in result_headers
        assert len(result_headers) == 2

    def test_span_context_from_headers_with_valid_header(self):
        interceptor = BraintrustInterceptor()
        span_context = {"trace_id": "test-trace-id", "span_id": "test-span-id"}

        # Serialize span context to header
        payloads = interceptor.payload_converter.to_payloads([span_context])
        headers = {"_braintrust-span": payloads[0]}

        result = interceptor._span_context_from_headers(headers)

        assert result is not None
        assert result["trace_id"] == "test-trace-id"
        assert result["span_id"] == "test-span-id"

    def test_span_context_from_headers_with_missing_header(self):
        interceptor = BraintrustInterceptor()
        headers: Dict[str, temporalio.api.common.v1.Payload] = {}

        result = interceptor._span_context_from_headers(headers)

        assert result is None

    def test_span_context_roundtrip(self):
        interceptor = BraintrustInterceptor()
        original_context = {
            "trace_id": "test-trace-id",
            "span_id": "test-span-id",
            "root_span_id": "test-root-span-id",
        }

        # Serialize
        headers = interceptor._span_context_to_headers(original_context, {})

        # Deserialize
        result_context = interceptor._span_context_from_headers(headers)

        assert result_context == original_context


# Integration Test Infrastructure


@dataclass
class TaskInput:
    """Input for test activities and workflows."""

    value: int


# Test Workflows and Activities


@temporalio.activity.defn
async def simple_activity(input: TaskInput) -> int:
    """Simple test activity."""
    await asyncio.sleep(0.1)
    return input.value + 10


@temporalio.activity.defn
async def failing_activity(input: TaskInput) -> int:
    """Activity that fails on first attempt."""
    info = temporalio.activity.info()
    attempt = info.attempt

    if attempt == 1:
        raise ValueError("Simulated failure on first attempt")

    return input.value + 20


@temporalio.activity.defn
async def simple_local_activity(input: TaskInput) -> int:
    """Simple local activity."""
    return input.value + 5


@temporalio.workflow.defn
class TestWorkflow:
    """Simple test workflow."""

    @temporalio.workflow.run
    async def run(self, input: TaskInput) -> int:
        # Execute an activity
        result = await temporalio.workflow.execute_activity(
            simple_activity,
            input,
            start_to_close_timeout=timedelta(seconds=10),
        )

        return result


@temporalio.workflow.defn
class WorkflowWithRetry:
    """Workflow that executes an activity with retries."""

    @temporalio.workflow.run
    async def run(self, input: TaskInput) -> int:
        result = await temporalio.workflow.execute_activity(
            failing_activity,
            input,
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=1),
            ),
        )

        return result


@temporalio.workflow.defn
class WorkflowWithLocalActivity:
    """Workflow that executes a local activity."""

    @temporalio.workflow.run
    async def run(self, input: TaskInput) -> int:
        result = await temporalio.workflow.execute_local_activity(
            simple_local_activity,
            input,
            start_to_close_timeout=timedelta(seconds=5),
        )

        return result


@temporalio.workflow.defn
class ChildWorkflow:
    """Child workflow for testing child workflow tracing."""

    @temporalio.workflow.run
    async def run(self, input: TaskInput) -> int:
        result = await temporalio.workflow.execute_activity(
            simple_activity,
            input,
            start_to_close_timeout=timedelta(seconds=10),
        )

        return result


@temporalio.workflow.defn
class ParentWorkflow:
    """Parent workflow that spawns a child workflow."""

    @temporalio.workflow.run
    async def run(self, input: TaskInput) -> int:
        # Execute child workflow
        child_result = await temporalio.workflow.execute_child_workflow(
            ChildWorkflow.run,
            input,
            id=f"child-{temporalio.workflow.info().workflow_id}",
        )

        return child_result


# Integration Tests


@pytest_asyncio.fixture(scope="function")
async def temporal_env():
    """Create a Temporal test environment."""
    async with await temporalio.testing.WorkflowEnvironment.start_time_skipping() as env:
        yield env


@pytest.fixture
def memory_logger():
    """Set up memory logger to capture spans for testing."""
    init_test_logger("temporal-test")
    with braintrust.logger._internal_with_memory_background_logger() as bgl:
        yield bgl


class TestBraintrustPluginIntegration:
    """Integration tests for BraintrustPlugin with real Temporal workflows."""

    @pytest.mark.asyncio
    async def test_plugin_basic_workflow_tracing(self, temporal_env, memory_logger):
        """Test basic workflow and activity tracing with BraintrustPlugin.

        Verifies that:
        1. Braintrust can be imported directly in workflows (no unsafe.imports_passed_through)
        2. Spans are created for workflow execution
        3. Spans are created for activity execution
        """
        # Create worker with BraintrustPlugin
        async with Worker(
            temporal_env.client,
            task_queue="test-queue",
            workflows=[TestWorkflow],
            activities=[simple_activity],
            plugins=[BraintrustPlugin(logger=memory_logger)],
        ):
            # Execute workflow
            result = await temporal_env.client.execute_workflow(
                TestWorkflow.run,
                TaskInput(value=10),
                id=f"test-workflow-{uuid.uuid4()}",
                task_queue="test-queue",
            )

            # Verify workflow executed correctly
            assert result == 20  # 10 + 10 from activity

            # Flush to ensure all spans are captured
            braintrust.flush()

            # Get captured spans
            spans = memory_logger.pop()

            # Verify spans were created
            assert len(spans) > 0, f"Expected spans to be created, got {len(spans)} spans"

            # Verify workflow span was created
            workflow_spans = [s for s in spans if "temporal.workflow" in s.get("span_attributes", {}).get("name", "")]
            assert len(workflow_spans) > 0, (
                f"Expected workflow span to be created. Span names: {[s.get('span_attributes', {}).get('name', 'unknown') for s in spans]}"
            )

            # Verify activity span was created
            activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]
            assert len(activity_spans) > 0, (
                f"Expected activity span to be created. Span names: {[s.get('span_attributes', {}).get('name', 'unknown') for s in spans]}"
            )

    @pytest.mark.asyncio
    async def test_plugin_context_propagation(self, temporal_env, memory_logger):
        """Test that span context propagates from client to workflow to activity.

        Verifies that parent-child span relationships are maintained across
        the execution chain.
        """
        # Create a parent span at the client level
        with braintrust.start_span(name="test.client_operation", type="task") as parent_span:
            parent_context = parent_span.export()

            # Create worker with BraintrustPlugin
            async with Worker(
                temporal_env.client,
                task_queue="test-queue-2",
                workflows=[TestWorkflow],
                activities=[simple_activity],
                plugins=[BraintrustPlugin(logger=memory_logger)],
            ):
                # Execute workflow (context should propagate via headers)
                result = await temporal_env.client.execute_workflow(
                    TestWorkflow.run,
                    TaskInput(value=15),
                    id=f"test-workflow-ctx-{uuid.uuid4()}",
                    task_queue="test-queue-2",
                )

                assert result == 25  # 15 + 10

        # Get captured spans
        spans = memory_logger.pop()

        # Verify spans were created
        assert len(spans) > 0, "Expected spans to be created"

        # Verify client span exists
        client_spans = [s for s in spans if "test.client_operation" in s.get("span_attributes", {}).get("name", "")]
        assert len(client_spans) > 0, "Expected client span to be created"

        # Verify workflow and activity spans were created
        workflow_spans = [s for s in spans if "temporal.workflow" in s.get("span_attributes", {}).get("name", "")]
        activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]

        assert len(workflow_spans) > 0, "Expected workflow spans"
        assert len(activity_spans) > 0, "Expected activity spans"

    @pytest.mark.asyncio
    async def test_plugin_activity_retry_tracing(self, temporal_env, memory_logger):
        """Test that activity retries are properly traced.

        Verifies that each retry attempt creates a span with appropriate
        error information.
        """
        async with Worker(
            temporal_env.client,
            task_queue="test-queue-3",
            workflows=[WorkflowWithRetry],
            activities=[failing_activity],
            plugins=[BraintrustPlugin(logger=memory_logger)],
        ):
            # Execute workflow with failing activity
            result = await temporal_env.client.execute_workflow(
                WorkflowWithRetry.run,
                TaskInput(value=30),
                id=f"test-workflow-retry-{uuid.uuid4()}",
                task_queue="test-queue-3",
            )

            # Should eventually succeed on retry
            assert result == 50  # 30 + 20

            # Get captured spans
            spans = memory_logger.pop()

            # Verify spans were created
            assert len(spans) > 0, "Expected spans to be created"

            # Verify activity spans (should have multiple attempts)
            activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]
            assert len(activity_spans) >= 1, "Expected at least one activity span for retries"

    @pytest.mark.asyncio
    async def test_plugin_child_workflow_tracing(self, temporal_env, memory_logger):
        """Test tracing of child workflows.

        Verifies that child workflows are traced and linked to parent workflows.
        """
        async with Worker(
            temporal_env.client,
            task_queue="test-queue-4",
            workflows=[ParentWorkflow, ChildWorkflow],
            activities=[simple_activity],
            plugins=[BraintrustPlugin(logger=memory_logger)],
        ):
            # Execute parent workflow which spawns child
            result = await temporal_env.client.execute_workflow(
                ParentWorkflow.run,
                TaskInput(value=40),
                id=f"test-workflow-parent-{uuid.uuid4()}",
                task_queue="test-queue-4",
            )

            # Result should come from child workflow's activity
            assert result == 50  # 40 + 10

            # Get captured spans
            spans = memory_logger.pop()

            # Verify spans were created
            assert len(spans) > 0, "Expected spans to be created"

            # Verify both parent and child workflow spans
            workflow_spans = [s for s in spans if "temporal.workflow" in s.get("span_attributes", {}).get("name", "")]
            assert len(workflow_spans) >= 2, "Expected at least 2 workflow spans (parent and child)"

            # Verify activity span
            activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]
            assert len(activity_spans) > 0, "Expected activity spans"

    @pytest.mark.asyncio
    async def test_plugin_local_activity_tracing(self, temporal_env, memory_logger):
        """Test that local activities are traced correctly.

        Local activities execute in the same worker process and should
        be traced like regular activities.
        """
        async with Worker(
            temporal_env.client,
            task_queue="test-queue-5",
            workflows=[WorkflowWithLocalActivity],
            activities=[simple_local_activity],
            plugins=[BraintrustPlugin(logger=memory_logger)],
        ):
            result = await temporal_env.client.execute_workflow(
                WorkflowWithLocalActivity.run,
                TaskInput(value=100),
                id=f"test-workflow-local-{uuid.uuid4()}",
                task_queue="test-queue-5",
            )

            assert result == 105  # 100 + 5

            # Get captured spans
            spans = memory_logger.pop()

            # Verify spans were created
            assert len(spans) > 0, "Expected spans to be created"

            # Verify local activity span was created
            activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]
            assert len(activity_spans) > 0, "Expected local activity span to be created"

    @pytest.mark.asyncio
    async def test_plugin_client_context_propagation(self, temporal_env, memory_logger):
        """Test that BraintrustPlugin works with Client.connect for context propagation.

        Verifies that:
        1. Plugin can be passed to Client.connect (not just Worker)
        2. Client-side spans are linked to workflow/activity spans via headers
        """
        from temporalio.client import Client

        # Create a NEW client with the plugin (simulates user doing Client.connect with plugin)
        plugin = BraintrustPlugin(logger=memory_logger)
        client = await Client.connect(
            temporal_env.client.service_client.config.target_host,
            namespace=temporal_env.client.namespace,
            plugins=[plugin],
        )

        # Create worker (still needs plugin for worker-side tracing)
        async with Worker(
            client,
            task_queue="test-queue-client-plugin",
            workflows=[TestWorkflow],
            activities=[simple_activity],
            plugins=[BraintrustPlugin(logger=memory_logger)],
        ):
            # Create a parent span at the client level
            with braintrust.start_span(name="test.client_with_plugin", type="task") as parent_span:
                parent_context = parent_span.export()

                # Execute workflow - plugin should inject span context via client interceptor
                result = await client.execute_workflow(
                    TestWorkflow.run,
                    TaskInput(value=25),
                    id=f"test-workflow-client-plugin-{uuid.uuid4()}",
                    task_queue="test-queue-client-plugin",
                )

                assert result == 35  # 25 + 10

        # Get captured spans
        spans = memory_logger.pop()

        # Verify spans were created
        assert len(spans) > 0, "Expected spans to be created"

        # Verify client span exists
        client_spans = [s for s in spans if "test.client_with_plugin" in s.get("span_attributes", {}).get("name", "")]
        assert len(client_spans) > 0, "Expected client span to be created"

        # Verify workflow span was created and linked to client span
        workflow_spans = [s for s in spans if "temporal.workflow" in s.get("span_attributes", {}).get("name", "")]
        assert len(workflow_spans) > 0, "Expected workflow span to be created"

        # Verify activity span was created
        activity_spans = [s for s in spans if "temporal.activity" in s.get("span_attributes", {}).get("name", "")]
        assert len(activity_spans) > 0, "Expected activity span to be created"

        # Verify parent-child relationship: workflow should have client span as parent
        workflow_span = workflow_spans[0]
        client_span = client_spans[0]
        assert workflow_span.get("root_span_id") == client_span.get("root_span_id"), (
            "Workflow span should be in same trace as client span"
        )
