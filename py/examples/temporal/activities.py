# @@@SNIPSTART python-money-transfer-project-template-withdraw
import asyncio
import os

from banking_service import BankingService, InvalidAccountError
from braintrust import wrap_openai
from openai import OpenAI
from shared import PaymentDetails
from temporalio import activity


class BankingActivities:
    def __init__(self):
        self.bank = BankingService("bank-api.example.com")
        self.openai_client = wrap_openai(OpenAI(api_key=os.environ.get("OPENAI_API_KEY")))

    @activity.defn
    async def withdraw(self, data: PaymentDetails) -> str:
        reference_id = f"{data.reference_id}-withdrawal"
        try:
            confirmation = await asyncio.to_thread(
                self.bank.withdraw, data.source_account, data.amount, reference_id
            )
            return confirmation
        except InvalidAccountError:
            raise
        except Exception:
            activity.logger.exception("Withdrawal failed")
            raise

    # @@@SNIPEND
    # @@@SNIPSTART python-money-transfer-project-template-deposit
    @activity.defn
    async def deposit(self, data: PaymentDetails) -> str:
        reference_id = f"{data.reference_id}-deposit"
        try:
            confirmation = await asyncio.to_thread(
                self.bank.deposit, data.target_account, data.amount, reference_id
            )
            """
            confirmation = await asyncio.to_thread(
                self.bank.deposit_that_fails,
                data.target_account,
                data.amount,
                reference_id,
            )
            """
            return confirmation
        except InvalidAccountError:
            raise
        except Exception:
            activity.logger.exception("Deposit failed")
            raise

    # @@@SNIPEND

    # @@@SNIPSTART python-money-transfer-project-template-refund
    @activity.defn
    async def refund(self, data: PaymentDetails) -> str:
        reference_id = f"{data.reference_id}-refund"
        try:
            confirmation = await asyncio.to_thread(
                self.bank.deposit, data.source_account, data.amount, reference_id
            )
            return confirmation
        except InvalidAccountError:
            raise
        except Exception:
            activity.logger.exception("Refund failed")
            raise

    # @@@SNIPEND

    @activity.defn
    async def analyze_transaction(self, data: PaymentDetails) -> str:
        try:
            response = await asyncio.to_thread(
                self.openai_client.chat.completions.create,
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a fraud detection system. Analyze transactions and respond with either 'APPROVED' or 'FLAGGED: <reason>'.",
                    },
                    {
                        "role": "user",
                        "content": f"Transaction: Transfer ${data.amount} from account {data.source_account} to {data.target_account}. Reference: {data.reference_id}",
                    },
                ],
                temperature=0.3,
            )
            result = response.choices[0].message.content or "APPROVED"
            activity.logger.info(f"Transaction analysis: {result}")
            return result
        except Exception:
            activity.logger.exception("Transaction analysis failed")
            raise
