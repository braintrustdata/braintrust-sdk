"""Abstract context management interface for Braintrust."""

import logging
import os
from abc import ABC, abstractmethod
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any


@dataclass
class SpanInfo:
    """Information about a span in the context."""

    trace_id: str
    span_id: str
    span_object: Any = None


@dataclass
class ParentSpanIds:
    root_span_id: str
    span_parents: list[str]


class ContextManager(ABC):
    """Abstract base class for managing span context in Braintrust.

    This provides a common interface for different context management
    implementations (e.g., OTEL-based, native Braintrust, etc.).
    """

    @abstractmethod
    def get_current_span_info(self) -> Any | None:
        """Get information about the currently active span.

        Returns:
            Information about the active span, or None if no span is active.
            The format of the returned data depends on the implementation.
        """
        pass

    @abstractmethod
    def get_parent_span_ids(self) -> ParentSpanIds | None:
        """Get parent span IDs for creating a new Braintrust span.

        Returns:
            ParentSpanIds with root_span_id and span_parents if available,
            None if no parent context exists.
        """
        pass

    @abstractmethod
    def set_current_span(self, span_object: Any) -> Any:
        """Set the current active span.

        Args:
            span_object: The span to set as current. Type depends on implementation.

        Returns:
            Context token for cleanup, or None if no cleanup is needed.
        """
        pass

    @abstractmethod
    def unset_current_span(self, context_token: Any = None) -> None:
        """Unset the current active span.

        Args:
            context_token: Token returned by set_current_span for cleanup.
        """
        pass


class BraintrustContextManager(ContextManager):
    """Braintrust-only context manager using contextvars when OTEL is not available."""

    def __init__(self):
        self._current_span: ContextVar[Any | None] = ContextVar("braintrust_current_span", default=None)

    def get_current_span_info(self) -> SpanInfo | None:
        """Get information about the currently active span."""
        current_span = self._current_span.get()
        if not current_span:
            return None

        # Return SpanInfo for BT spans
        return SpanInfo(trace_id=current_span.root_span_id, span_id=current_span.span_id, span_object=current_span)

    def get_parent_span_ids(self) -> ParentSpanIds | None:
        """Get parent information for creating a new Braintrust span."""
        current_span = self._current_span.get()
        if not current_span:
            return None

        # If current span is a BT span, use it as parent
        return ParentSpanIds(root_span_id=current_span.root_span_id, span_parents=[current_span.span_id])

    def set_current_span(self, span_object: Any) -> Any:
        """Set the current active span."""
        return self._current_span.set(span_object)

    def unset_current_span(self, context_token: Any = None) -> None:
        """Unset the current active span."""
        if context_token:
            self._current_span.reset(context_token)
        else:
            self._current_span.set(None)


def get_context_manager() -> ContextManager:
    """Get the appropriate context manager based on OTEL availability and configuration.

    Returns:
        OTEL-based context manager if OTEL is explicitly enabled,
        Braintrust-only context manager by default.
    """

    # Check if OTEL should be explicitly enabled via environment variable
    if os.environ.get("BRAINTRUST_OTEL_COMPAT", "").lower() in ("1", "true", "yes"):
        try:
            from braintrust.otel.context import ContextManager as OtelContextManager

            return OtelContextManager()
        except ImportError:
            logging.warning("OTEL not available, falling back to Braintrust-only version")

    # Default to Braintrust-only context manager
    return BraintrustContextManager()
