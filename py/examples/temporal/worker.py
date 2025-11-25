import asyncio
import os

from braintrust.contrib.temporal import BraintrustPlugin

# Import only what we need to avoid loading optional dependencies
from braintrust.logger import init_logger

# Initialize logger at module level before importing plugin
init_logger(project="temporal-example")

from temporalio.client import Client
from temporalio.worker import Worker
from workflow import (
    TASK_QUEUE_NAME,
    ChildWorkflow,
    SimpleWorkflow,
    add_ten,
    add_three_local,
    cube,
    divide_by_two_with_retry,
    multiply_by_two,
    square,
    subtract_five,
)


async def main() -> None:
    worker_id = f"pid-{os.getpid()}"

    client: Client = await Client.connect("localhost:7233")

    worker: Worker = Worker(
        client,
        task_queue=TASK_QUEUE_NAME,
        workflows=[SimpleWorkflow, ChildWorkflow],
        activities=[
            add_ten,
            multiply_by_two,
            subtract_five,
            add_three_local,
            divide_by_two_with_retry,
            square,
            cube,
        ],
        plugins=[BraintrustPlugin()],
    )

    print(f"{worker_id} started on task queue: {TASK_QUEUE_NAME}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
