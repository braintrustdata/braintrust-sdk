"""
Braintrust integration for LangChain.

Provides automatic tracing of LangChain chains, agents, and LLM calls.

Example usage with auto_instrument():
    ```python
    import braintrust
    braintrust.init_logger(project="my-project")
    braintrust.auto_instrument()

    # All LangChain operations are now automatically traced
    from langchain_openai import ChatOpenAI
    model = ChatOpenAI(model="gpt-4o-mini")
    model.invoke("Hello!")  # Automatically traced
    ```

Example usage with setup_langchain():
    ```python
    from braintrust.wrappers.langchain import setup_langchain, BraintrustCallbackHandler
    setup_langchain(project_name="my-project")

    # All LangChain operations are now automatically traced
    from langchain_openai import ChatOpenAI
    model = ChatOpenAI(model="gpt-4o-mini")
    model.invoke("Hello!")  # Automatically traced
    ```

Example usage with manual handler:
    ```python
    from braintrust.wrappers.langchain import BraintrustCallbackHandler
    from langchain_openai import ChatOpenAI

    handler = BraintrustCallbackHandler()
    model = ChatOpenAI(model="gpt-4o-mini")
    model.invoke("Hello!", config={"callbacks": [handler]})
    ```
"""

import logging

from braintrust.logger import NOOP_SPAN, current_span, init_logger

from .callbacks import BraintrustCallbackHandler
from .context import clear_global_handler, set_global_handler

__all__ = [
    "setup_langchain",
    "BraintrustCallbackHandler",
    "set_global_handler",
    "clear_global_handler",
]

_logger = logging.getLogger(__name__)


def setup_langchain(
    api_key: str | None = None,
    project_id: str | None = None,
    project_name: str | None = None,
) -> bool:
    """
    Setup Braintrust integration with LangChain.

    Automatically registers a BraintrustCallbackHandler as the global handler,
    enabling automatic tracing of all LangChain operations.

    Args:
        api_key: Braintrust API key (optional, uses env var if not provided)
        project_id: Braintrust project ID
        project_name: Braintrust project name

    Returns:
        True if setup was successful, False if langchain is not installed.

    Example:
        ```python
        import braintrust
        from braintrust.wrappers.langchain import setup_langchain

        setup_langchain(project_name="my-langchain-app")

        # All LangChain operations are now automatically traced
        from langchain_openai import ChatOpenAI
        model = ChatOpenAI(model="gpt-4o-mini")
        model.invoke("Hello!")  # Automatically traced
        ```
    """
    span = current_span()
    if span == NOOP_SPAN:
        init_logger(project=project_name, api_key=api_key, project_id=project_id)

    try:
        # Verify langchain is installed by importing core module
        from langchain_core.callbacks.base import BaseCallbackHandler as _  # noqa: F401

        # Create and register global handler
        handler = BraintrustCallbackHandler()
        set_global_handler(handler)

        return True
    except ImportError:
        # langchain not installed
        return False
