"""Unified span context management for Braintrust and OTEL."""

import logging
from typing import Any, Dict, Optional

# Import OTEL at module level to contain all OTEL dependencies here
try:
    from opentelemetry import trace
    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False
    trace = None

log = logging.getLogger(__name__)


class ActiveSpanInfo:
    """Information about the currently active span."""

    def __init__(self, trace_id: str, span_id: str, span_type: str, span_object: Any = None):
        self.trace_id = trace_id
        self.span_id = span_id
        self.span_type = span_type  # 'otel' or 'bt'
        self.span_object = span_object


class UnifiedSpanContext:
    """Single source of truth for active span context.

    Priority order:
    1. If OTEL is installed and has active span: Use OTEL context
    2. Otherwise: Use Braintrust context (if available)

    This eliminates conflicts between dual context systems.
    """

    def __init__(self):
        self._otel_available = OTEL_AVAILABLE

    def get_active_span_info(self) -> Optional[ActiveSpanInfo]:
        """Get information about the currently active span.

        Returns:
            ActiveSpanInfo if there's an active span, None otherwise
        """
        # Priority 1: OTEL context (if available)
        if self._otel_available:
            otel_info = self._get_otel_span_info()
            if otel_info:
                return otel_info

        # Priority 2: Braintrust context
        bt_info = self._get_bt_span_info()
        if bt_info:
            return bt_info

        return None

    def _get_otel_span_info(self) -> Optional[ActiveSpanInfo]:
        """Get OTEL span information if available."""
        if not self._otel_available or not trace:
            return None

        try:
            current_span = trace.get_current_span()
            if current_span and hasattr(current_span, 'get_span_context'):
                span_context = current_span.get_span_context()
                if span_context and span_context.span_id != 0:
                    return ActiveSpanInfo(
                        trace_id=format(span_context.trace_id, '032x'),
                        span_id=format(span_context.span_id, '016x'),
                        span_type='otel',
                        span_object=current_span
                    )
        except Exception as e:
            log.debug(f"Failed to get OTEL span info: {e}")

        return None

    def _get_bt_span_info(self) -> Optional[ActiveSpanInfo]:
        """Get Braintrust span information if available."""
        # TODO: Implement BT context detection
        # For now, we'll rely on OTEL being the primary context system
        # BT spans will be created within OTEL context when OTEL is available
        return None

    def should_use_otel_context(self) -> bool:
        """Check if we should use OTEL context for span creation."""
        if not self._otel_available:
            return False

        active = self.get_active_span_info()
        return active is not None and active.span_type == 'otel'

    def should_use_bt_context(self) -> bool:
        """Check if we should use BT context for span creation."""
        active = self.get_active_span_info()
        return active is not None and active.span_type == 'bt'

    def get_parent_info_for_bt_span(self) -> Optional[Dict[str, Any]]:
        """Get parent information for creating a new BT span.

        Returns:
            Dict with parent info if there's an active span, None if should be root
        """
        active = self.get_active_span_info()
        if not active:
            return None

        if active.span_type == 'otel':
            # BT span should inherit OTEL trace ID and use OTEL span as parent
            return {
                'root_span_id': active.trace_id,
                'span_parents': [active.span_id],
                'metadata': {
                    'otel_trace_id': active.trace_id,
                    'otel_span_id': active.span_id
                }
            }
        elif active.span_type == 'bt':
            # BT span should use BT parent
            return {
                'root_span_id': active.trace_id,
                'span_parents': [active.span_id]
            }

        return None


# Global instance
_unified_context = UnifiedSpanContext()


def get_unified_context() -> UnifiedSpanContext:
    """Get the global unified span context instance."""
    return _unified_context


def get_active_span_info() -> Optional[ActiveSpanInfo]:
    """Get information about the currently active span."""
    return _unified_context.get_active_span_info()


def should_use_otel_context() -> bool:
    """Check if we should use OTEL context for span creation."""
    return _unified_context.should_use_otel_context()


def should_use_bt_context() -> bool:
    """Check if we should use BT context for span creation."""
    return _unified_context.should_use_bt_context()


def get_parent_info_for_bt_span() -> Optional[Dict[str, Any]]:
    """Get parent information for creating a new BT span."""
    return _unified_context.get_parent_info_for_bt_span()
