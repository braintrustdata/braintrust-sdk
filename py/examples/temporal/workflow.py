import asyncio
import os
from dataclasses import dataclass
from datetime import timedelta

import braintrust
from temporalio import activity, workflow
from temporalio.common import RetryPolicy

TASK_QUEUE_NAME = "braintrust-example-task-queue"


@dataclass
class TaskInput:
    value: int


@activity.defn
async def add_ten(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] Adding 10 to {input.value}")

    # Sleep to simulate realistic work
    await asyncio.sleep(0.5)

    # Create child span within activity to test nested tracing
    with braintrust.start_span(name="validate_input", type="task") as span:
        span.log(input={"value": input.value, "operation": "add_ten"})
        await asyncio.sleep(0.2)

    result = input.value + 10
    print(f"[{worker_id}] Result: {input.value} + 10 = {result}")
    return result


@activity.defn
async def multiply_by_two(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] Multiplying {input.value} by 2")

    # Sleep to simulate realistic work
    await asyncio.sleep(0.3)

    # Create child span to demonstrate nested tracing
    with braintrust.start_span(name="perform_multiplication", type="task") as span:
        span.log(input={"value": input.value, "multiplier": 2})
        await asyncio.sleep(0.2)
        result = input.value * 2
        span.log(output={"result": result})

    print(f"[{worker_id}] Result: {input.value} * 2 = {result}")
    return result


@activity.defn
async def subtract_five(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] Subtracting 5 from {input.value}")

    # Sleep to simulate realistic work
    await asyncio.sleep(0.3)

    result = input.value - 5
    print(f"[{worker_id}] Result: {input.value} - 5 = {result}")
    return result


# Local activity - runs in the same worker process as the workflow
@activity.defn
async def add_three_local(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] [LOCAL] Adding 3 to {input.value}")

    # Sleep to simulate realistic work (local activities are typically faster)
    await asyncio.sleep(0.1)

    # Create child span to verify local activity tracing works
    with braintrust.start_span(name="local_calculation", type="task") as span:
        span.log(input={"value": input.value, "operation": "add_three_local"})
        await asyncio.sleep(0.05)
        result = input.value + 3
        span.log(output={"result": result})

    print(f"[{worker_id}] [LOCAL] Result: {input.value} + 3 = {result}")
    return result


# Activity with retry logic - fails first time, succeeds on retry
_divide_attempt_count = {}


@activity.defn
async def divide_by_two_with_retry(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    activity_id = activity.info().activity_id

    # Track attempts per activity_id
    if activity_id not in _divide_attempt_count:
        _divide_attempt_count[activity_id] = 0
    _divide_attempt_count[activity_id] += 1

    attempt = _divide_attempt_count[activity_id]
    print(f"[{worker_id}] Attempt {attempt}: Dividing {input.value} by 2")

    # Sleep to simulate work
    await asyncio.sleep(0.4)

    # Fail on first attempt to test retry tracing
    if attempt == 1:
        raise ValueError("Simulated error for retry testing")

    result = input.value // 2
    print(f"[{worker_id}] Result: {input.value} / 2 = {result}")
    return result


# Parallel activities for testing concurrent execution
@activity.defn
async def square(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] Squaring {input.value}")

    # Sleep to simulate work - should run in parallel with cube
    await asyncio.sleep(0.6)

    result = input.value * input.value
    print(f"[{worker_id}] Result: {input.value}^2 = {result}")
    return result


@activity.defn
async def cube(input: TaskInput) -> int:
    worker_id = f"pid-{os.getpid()}"
    print(f"[{worker_id}] Cubing {input.value}")

    # Sleep to simulate work - should run in parallel with square
    await asyncio.sleep(0.7)

    result = input.value * input.value * input.value
    print(f"[{worker_id}] Result: {input.value}^3 = {result}")
    return result


# Child workflow for testing nested workflow tracing
@workflow.defn
class ChildWorkflow:
    @workflow.run
    async def run(self, input: TaskInput) -> int:
        workflow.logger.info(f"Child workflow processing: {input.value}")

        # Simple operation in child workflow
        result = await workflow.execute_activity(
            subtract_five,
            input,
            start_to_close_timeout=timedelta(seconds=10),
        )

        workflow.logger.info(f"Child workflow result: {result}")
        return result


@workflow.defn
class SimpleWorkflow:
    def __init__(self) -> None:
        self._signal_value = 0

    @workflow.signal
    def add_signal_value(self, value: int) -> None:
        """Signal handler for testing signal tracing."""
        workflow.logger.info(f"Received signal with value: {value}")
        self._signal_value += value

    @workflow.run
    async def run(self, input: TaskInput) -> str:
        workflow.logger.info(f"Starting workflow with value: {input.value}")

        with braintrust.start_span(name="manual.workflow.span") as span:
            pass

        # Step 1: Add 10
        step1 = await workflow.execute_activity(
            add_ten,
            input,
            start_to_close_timeout=timedelta(seconds=10),
        )
        workflow.logger.info(f"After step 1: {step1}")

        # Step 2: Multiply by 2
        step2 = await workflow.execute_activity(
            multiply_by_two,
            TaskInput(value=step1),
            start_to_close_timeout=timedelta(seconds=10),
        )
        workflow.logger.info(f"After step 2: {step2}")

        # Step 2.5: Local activity (fast operation in same worker)
        workflow.logger.info("Executing local activity")
        step2_5 = await workflow.execute_local_activity(
            add_three_local,
            TaskInput(value=step2),
            start_to_close_timeout=timedelta(seconds=5),
        )
        workflow.logger.info(f"After local activity: {step2_5}")

        # Step 3: Parallel activities (square and cube)
        workflow.logger.info("Executing parallel activities")
        square_result, cube_result = await asyncio.gather(
            workflow.execute_activity(
                square,
                TaskInput(value=step2),
                start_to_close_timeout=timedelta(seconds=10),
            ),
            workflow.execute_activity(
                cube,
                TaskInput(value=step2),
                start_to_close_timeout=timedelta(seconds=10),
            ),
        )
        workflow.logger.info(f"Parallel results: square={square_result}, cube={cube_result}")

        # Step 4: Activity with retry
        workflow.logger.info("Executing activity with retry")
        step4 = await workflow.execute_activity(
            divide_by_two_with_retry,
            TaskInput(value=step2),
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(
                maximum_attempts=3,
                initial_interval=timedelta(seconds=1),
            ),
        )
        workflow.logger.info(f"After retry activity: {step4}")

        # Step 5: Child workflow
        workflow.logger.info("Starting child workflow")
        child_result = await workflow.execute_child_workflow(
            ChildWorkflow.run,
            TaskInput(value=step4),
            id=f"child-{workflow.info().workflow_id}",
            task_queue=TASK_QUEUE_NAME,
        )
        workflow.logger.info(f"Child workflow result: {child_result}")

        # Include signal value in result
        final_result = (
            f"Complete: {input.value} -> +10={step1} -> *2={step2} -> "
            f"+3(local)={step2_5} -> parallel(^2={square_result}, ^3={cube_result}) -> "
            f"/2={step4} -> child(-5={child_result}) + signal({self._signal_value}) = "
            f"{child_result + self._signal_value}"
        )
        workflow.logger.info(final_result)
        return final_result
