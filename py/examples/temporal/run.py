import asyncio
import sys
import uuid

import braintrust
from braintrust.contrib.temporal import BraintrustPlugin
from temporalio.client import Client
from workflow import TASK_QUEUE_NAME, SimpleWorkflow, TaskInput


async def main() -> None:
    """Execute a workflow."""
    braintrust.init_logger(project="temporal-example")

    client: Client = await Client.connect(
        "localhost:7233",
        plugins=[BraintrustPlugin()],
    )

    input_data = TaskInput(value=5)
    workflow_id = f"simple-workflow-{uuid.uuid4().hex[:8]}"

    print(f"Starting workflow with value: {input_data.value}")
    print(f"Workflow ID: {workflow_id}")

    # Start a span for the client call
    with braintrust.start_span(name="example.temporal.workflow") as span:
        # Start the workflow (non-blocking)
        handle = await client.start_workflow(
            SimpleWorkflow.run,
            input_data,
            id=workflow_id,
            task_queue=TASK_QUEUE_NAME,
        )

        # Optionally send a signal if --signal argument is provided
        if "--signal" in sys.argv:
            signal_value = 100
            print(f"\nSending signal with value: {signal_value}")
            await handle.signal(SimpleWorkflow.add_signal_value, signal_value)

        # Wait for workflow to complete
        result = await handle.result()

        span.log(output=result)
        print(f"\nResult: {result}")
        print(f"\nView trace: {span.permalink()}")


if __name__ == "__main__":
    asyncio.run(main())
