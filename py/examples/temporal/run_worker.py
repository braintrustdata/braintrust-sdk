# @@@SNIPSTART python-money-transfer-project-template-run-worker
import asyncio

from activities import BankingActivities
from shared import MONEY_TRANSFER_TASK_QUEUE_NAME
from temporalio.client import Client
from temporalio.worker import Worker
from workflows import MoneyTransfer


async def main() -> None:
    client: Client = await Client.connect("localhost:7233", namespace="default")
    # Run the worker
    activities = BankingActivities()
    worker: Worker = Worker(
        client,
        task_queue=MONEY_TRANSFER_TASK_QUEUE_NAME,
        workflows=[MoneyTransfer],
        activities=[activities.withdraw, activities.deposit, activities.refund],
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
# @@@SNIPEND
