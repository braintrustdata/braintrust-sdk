"""
Span context management for Braintrust logging.

This module provides the SpanContext class that handles the current active span
and parent span context using Python's contextvars for thread-safe and async-safe context management.
"""

import contextvars
from typing import Any, Optional


class SpanContext:
    """Manages the current active span and parent context using contextvars."""

    def __init__(self):
        self.current_span: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar(
            "braintrust_current_span", default=None
        )
        self.current_parent: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
            "braintrust_current_parent", default=None
        )

    def get_current_span(self) -> Optional[Any]:
        """Get the currently active span."""
        return self.current_span.get()

    def set_current_span(self, span: Any) -> contextvars.Token:
        """Set the current span and return a token for resetting."""
        return self.current_span.set(span)

    def reset_current_span(self, token: contextvars.Token) -> None:
        """Reset the current span using the provided token."""
        self.current_span.reset(token)

    def get_current_parent(self) -> Optional[str]:
        """Get the current parent context."""
        return self.current_parent.get()

    def set_current_parent(self, parent: Optional[str]) -> contextvars.Token:
        """Set the current parent context and return a token for resetting."""
        return self.current_parent.set(parent)

    def reset_current_parent(self, token: contextvars.Token) -> None:
        """Reset the current parent context using the provided token."""
        self.current_parent.reset(token)
