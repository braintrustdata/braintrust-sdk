"""
Auto-instrumentation for AI/ML libraries.

Provides one-line instrumentation for supported libraries.
"""

from __future__ import annotations

__all__ = ["auto_instrument"]

_instrumented: set[str] = set()


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

    Call this once at the start of your program, before importing
    the libraries you want to trace.

    Safe to call multiple times - already instrumented libraries are skipped.

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

        # Instrument all available libraries
        braintrust.auto_instrument()

        # Or selectively instrument
        braintrust.auto_instrument(openai=True, anthropic=False)

        # Your code now automatically logs to Braintrust
        import openai
        client = openai.OpenAI()
        response = client.chat.completions.create(...)  # Auto-traced!
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
    """Instrument OpenAI if available."""
    if "openai" in _instrumented:
        return True
    try:
        from braintrust.oai import patch_openai

        patch_openai()
        _instrumented.add("openai")
        return True
    except ImportError:
        return False


def _instrument_anthropic() -> bool:
    """Instrument Anthropic if available."""
    if "anthropic" in _instrumented:
        return True
    try:
        from braintrust.wrappers.anthropic import patch_anthropic

        patch_anthropic()
        _instrumented.add("anthropic")
        return True
    except ImportError:
        return False


def _instrument_litellm() -> bool:
    """Instrument LiteLLM if available."""
    if "litellm" in _instrumented:
        return True
    try:
        from braintrust.wrappers.litellm import patch_litellm

        patch_litellm()
        _instrumented.add("litellm")
        return True
    except ImportError:
        return False


def _instrument_pydantic_ai() -> bool:
    """Instrument Pydantic AI if available."""
    if "pydantic_ai" in _instrumented:
        return True
    try:
        from braintrust.wrappers.pydantic_ai import setup_pydantic_ai

        setup_pydantic_ai()
        _instrumented.add("pydantic_ai")
        return True
    except ImportError:
        return False


def _instrument_google_genai() -> bool:
    """Instrument Google GenAI if available."""
    if "google_genai" in _instrumented:
        return True
    try:
        from braintrust.wrappers.google_genai import setup_genai

        setup_genai()
        _instrumented.add("google_genai")
        return True
    except ImportError:
        return False


def _instrument_agno() -> bool:
    """Instrument Agno if available."""
    if "agno" in _instrumented:
        return True
    try:
        from braintrust.wrappers.agno import setup_agno

        setup_agno()
        _instrumented.add("agno")
        return True
    except ImportError:
        return False


def _instrument_claude_agent_sdk() -> bool:
    """Instrument Claude Agent SDK if available."""
    if "claude_agent_sdk" in _instrumented:
        return True
    try:
        from braintrust.wrappers.claude_agent_sdk import setup_claude_agent_sdk

        setup_claude_agent_sdk()
        _instrumented.add("claude_agent_sdk")
        return True
    except ImportError:
        return False


def _instrument_dspy() -> bool:
    """Instrument DSPy if available."""
    if "dspy" in _instrumented:
        return True
    try:
        from braintrust.wrappers.dspy import patch_dspy

        patch_dspy()
        _instrumented.add("dspy")
        return True
    except ImportError:
        return False
