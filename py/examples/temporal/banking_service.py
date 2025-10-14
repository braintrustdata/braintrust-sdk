""" This code simulates a client for a hypothetical banking service.
It supports both withdrawals and deposits, and generates a random transaction ID for each request.

Tip: You can modify these functions to introduce delays or errors, allowing
you to experiment with failures and timeouts.
"""
import uuid
from dataclasses import dataclass
from typing import NoReturn


@dataclass
class InsufficientFundsError(Exception):
    """Exception for handling insufficient funds.

    Attributes:
        message: The message to display.

    Args:
        message: The message to display.

    """

    def __init__(self, message) -> None:
        self.message: str = message
        super().__init__(self.message)


@dataclass
class InvalidAccountError(Exception):
    """Exception for invalid account numbers.

    Attributes:
        message: The message to display.

    Args:
        message: The message to display.

    """

    def __init__(self, message) -> None:
        self.message: str = message
        super().__init__(self.message)


@dataclass
class Account:
    """A class representing a bank account.

    Attributes:
        account_number: The account number for the account.
        balance: The balance of the account.

    Args:
        account_number: The account number for the account.
        balance: The balance of the account.
    """

    def __init__(self, account_number: str, balance: int) -> None:
        self.account_number: str = account_number
        self.balance: int = balance


@dataclass
class Bank:
    """
    A Bank with a list of accounts.

    The Bank class provides methods for finding an account with a given account number.

    Attributes:
        accounts: A list of Account objects representing the bank's accounts.
    """

    def __init__(self, accounts: list[Account]) -> None:
        self.accounts: list[Account] = accounts

    def find_account(self, account_number: str) -> Account:
        """
        Finds and returns the Account object with the given account number.

        Args:
            account_number: The account number to search for.

        Returns:
            The Account object with the given account number.

        Raises:
            ValueError: If no account with the given account number is
                found in the bank's accounts list.
        """
        for account in self.accounts:
            if account.account_number == account_number:
                return account
        raise InvalidAccountError(f"The account number {account_number} is invalid.")


@dataclass
class BankingService:
    """
    A mock implementation of a banking API.

    The BankingService class provides methods for simulating deposits and withdrawals
    from bank accounts, as well as a method for simulating a deposit that always fails.

    Attributes:
        hostname: The hostname of the banking API service.
    """

    def __init__(self, hostname: str) -> None:
        """
        Constructs a new BankingService object with the given hostname.

        Args:
            hostname: The hostname of the banking API service.
        """
        self.hostname: str = hostname

        self.mock_bank: Bank = Bank(
            [
                Account("85-150", 2000),
                Account("43-812", 0),
            ]
        )

    def withdraw(self, account_number: str, amount: int, reference_id: str) -> str:
        """
        Simulates a withdrawal from a bank account.

        Args:
            account_number: The account number to deposit to.
            amount: The amount to deposit to the account.
            reference_id: An identifier for the transaction, used for idempotency.

        Returns:
            A transaction ID

        Raises:
            InvalidAccountError: If the account number is invalid.
            InsufficientFundsError: If the account does not have enough funds
                to complete the withdrawal.
        """

        account = self.mock_bank.find_account(account_number)

        if amount > account.balance:
            raise InsufficientFundsError(
                f"The account {account_number} has insufficient funds to complete this transaction."
            )

        return self.generate_transaction_id("W")

    def deposit(self, account_number: str, amount: int, reference_id: str) -> str:
        """
        Simulates a deposit to a bank account.

        Args:
            account_number: The account number to deposit to.
            amount: The amount to deposit to the account.
            reference_id: An identifier for the transaction, used for idempotency.

        Returns:
            A transaction ID.

        Raises:
            InvalidAccountError: If the account number is invalid.
        """
        try:
            self.mock_bank.find_account(account_number)
        except InvalidAccountError:
            raise

        return self.generate_transaction_id("D")

    def deposit_that_fails(
        self, account_number: str, amount: int, reference_id: str
    ) -> NoReturn:
        """
        Simulates a deposit to a bank account that always fails with an
        unknown error.

        Args:
            account_number: The account number to deposit to.
            amount: The amount to deposit to the account.
            reference_id: An identifier for the transaction, used for idempotency.

        Returns:
            An empty string.

        Raises:
            A ValueError exception object.
        """
        raise ValueError("This deposit has failed.")

    def generate_transaction_id(self, prefix: str) -> str:
        """
        Generates a transaction ID we can send back.

        Args:
            prefix: A prefix so you can identify the type of transaction.
        Returns:
            The transaction id.
        """
        return f"{prefix}-{uuid.uuid4()}"
