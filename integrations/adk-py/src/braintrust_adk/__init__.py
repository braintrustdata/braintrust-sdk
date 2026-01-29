"""
braintrust-adk is deprecated. ADK integration is now included in the main braintrust package.

To migrate:
1. Remove braintrust-adk from your dependencies
2. Change imports from `braintrust_adk` to `braintrust.wrappers.adk`

Example:
    # Old (deprecated):
    from braintrust_adk import setup_adk

    # New:
    from braintrust.wrappers.adk import setup_adk

    # Or use auto_instrument():
    import braintrust
    braintrust.auto_instrument()  # ADK is automatically instrumented
"""

import warnings

warnings.warn(
    "braintrust-adk is deprecated. ADK integration is now included in the main braintrust package. "
    "Change imports from 'braintrust_adk' to 'braintrust.wrappers.adk', "
    "or use braintrust.auto_instrument() for automatic instrumentation.",
    DeprecationWarning,
    stacklevel=2,
)

# Re-export everything from the new location for backward compatibility
from contextlib import aclosing

from braintrust import init_logger, start_span
from braintrust.bt_json import bt_safe_deep_copy
from braintrust.wrappers.adk import (
    _determine_llm_call_type,
    _extract_metrics,
    _extract_model_name,
    _is_patched,
    _omit,
    _serialize_config,
    _serialize_content,
    _serialize_part,
    _serialize_pydantic_schema,
    setup_adk,
    setup_braintrust,
    wrap_agent,
    wrap_flow,
    wrap_mcp_tool,
    wrap_runner,
)

__all__ = [
    "setup_braintrust",
    "setup_adk",
    "wrap_agent",
    "wrap_runner",
    "wrap_flow",
    "wrap_mcp_tool",
    # Re-exported from braintrust for backward compatibility
    "aclosing",
    "bt_safe_deep_copy",
    "init_logger",
    "start_span",
    # Internal functions also exported for backward compatibility
    "_determine_llm_call_type",
    "_is_patched",
    "_serialize_content",
    "_serialize_part",
    "_serialize_pydantic_schema",
    "_serialize_config",
    "_omit",
    "_extract_metrics",
    "_extract_model_name",
]
