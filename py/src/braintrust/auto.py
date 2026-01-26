"""
Auto-instrumentation for AI/ML libraries.

Provides one-line instrumentation for supported libraries.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager

__all__ = ["auto_instrument"]

logger = logging.getLogger(__name__)


@contextmanager
def _try_patch():
    """Context manager that suppresses ImportError and logs other exceptions."""
    try:
        yield
    except ImportError:
        pass
    except Exception:
        logger.exception("Failed to instrument")


def auto_instrument(
    *,
    openai: bool = True,
    anthropic: bool = True,
    litellm: bool = True,
    pydantic_ai: bool = True,
    google_genai: bool = True,
    agno: bool = True,
    claude_agent_sdk: bool = True,
    dspy: bool = True,
) -> dict[str, bool]:
    """
    Auto-instrument supported AI/ML libraries for Braintrust tracing.

    Safe to call multiple times - already instrumented libraries are skipped.

    Note on import order: If you use `from openai import OpenAI` style imports,
    call auto_instrument() first. If you use `import openai` style imports,
    order doesn't matter since attribute lookup happens dynamically.

    Args:
        openai: Enable OpenAI instrumentation (default: True)
        anthropic: Enable Anthropic instrumentation (default: True)
        litellm: Enable LiteLLM instrumentation (default: True)
        pydantic_ai: Enable Pydantic AI instrumentation (default: True)
        google_genai: Enable Google GenAI instrumentation (default: True)
        agno: Enable Agno instrumentation (default: True)
        claude_agent_sdk: Enable Claude Agent SDK instrumentation (default: True)
        dspy: Enable DSPy instrumentation (default: True)

    Returns:
        Dict mapping integration name to whether it was successfully instrumented.

    Example:
        ```python
        import braintrust
        braintrust.auto_instrument()

        # OpenAI
        import openai
        client = openai.OpenAI()
        client.chat.completions.create(model="gpt-4o-mini", messages=[...])

        # Anthropic
        import anthropic
        client = anthropic.Anthropic()
        client.messages.create(model="claude-sonnet-4-20250514", messages=[...])

        # LiteLLM
        import litellm
        litellm.completion(model="gpt-4o-mini", messages=[...])

        # DSPy
        import dspy
        lm = dspy.LM("openai/gpt-4o-mini")
        dspy.configure(lm=lm)

        # Pydantic AI
        from pydantic_ai import Agent
        agent = Agent("openai:gpt-4o-mini")
        result = agent.run_sync("Hello!")

        # Google GenAI
        from google.genai import Client
        client = Client()
        client.models.generate_content(model="gemini-2.0-flash", contents="Hello!")
        ```
    """
    results = {}

    if openai:
        results["openai"] = _instrument_openai()
    if anthropic:
        results["anthropic"] = _instrument_anthropic()
    if litellm:
        results["litellm"] = _instrument_litellm()
    if pydantic_ai:
        results["pydantic_ai"] = _instrument_pydantic_ai()
    if google_genai:
        results["google_genai"] = _instrument_google_genai()
    if agno:
        results["agno"] = _instrument_agno()
    if claude_agent_sdk:
        results["claude_agent_sdk"] = _instrument_claude_agent_sdk()
    if dspy:
        results["dspy"] = _instrument_dspy()

    return results


def _instrument_openai() -> bool:
    with _try_patch():
        from braintrust.oai import patch_openai

        return patch_openai()
    return False


def _instrument_anthropic() -> bool:
    with _try_patch():
        from braintrust.wrappers.anthropic import patch_anthropic

        return patch_anthropic()
    return False


def _instrument_litellm() -> bool:
    with _try_patch():
        from braintrust.wrappers.litellm import patch_litellm

        return patch_litellm()
    return False


def _instrument_pydantic_ai() -> bool:
    with _try_patch():
        from braintrust.wrappers.pydantic_ai import setup_pydantic_ai

        return setup_pydantic_ai()
    return False


def _instrument_google_genai() -> bool:
    with _try_patch():
        from braintrust.wrappers.google_genai import setup_genai

        return setup_genai()
    return False


def _instrument_agno() -> bool:
    with _try_patch():
        from braintrust.wrappers.agno import setup_agno

        return setup_agno()
    return False


def _instrument_claude_agent_sdk() -> bool:
    with _try_patch():
        from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

        return setup_claude_agent_sdk()
    return False


def _instrument_dspy() -> bool:
    with _try_patch():
        from braintrust.wrappers.dspy import patch_dspy

        return patch_dspy()
    return False
