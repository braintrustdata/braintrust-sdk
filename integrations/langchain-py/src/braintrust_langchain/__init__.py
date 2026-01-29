"""
braintrust-langchain is deprecated. Use braintrust.wrappers.langchain instead.

To migrate:
1. Remove braintrust-langchain from your dependencies
2. Change imports from `braintrust_langchain` to `braintrust.wrappers.langchain`
3. Or use `braintrust.auto_instrument()` for automatic instrumentation

Example:
    # Old way (deprecated)
    from braintrust_langchain import BraintrustCallbackHandler, set_global_handler

    # New way
    from braintrust.wrappers.langchain import BraintrustCallbackHandler, set_global_handler

    # Or use auto-instrumentation
    import braintrust
    braintrust.auto_instrument()
"""

import warnings

warnings.warn(
    "braintrust-langchain is deprecated. Use 'from braintrust.wrappers.langchain import BraintrustCallbackHandler' "
    "or 'braintrust.auto_instrument()' instead. This package will be removed in a future version.",
    DeprecationWarning,
    stacklevel=2,
)

# Re-export from new location for backward compatibility
from braintrust.wrappers.langchain import (
    BraintrustCallbackHandler,
    clear_global_handler,
    set_global_handler,
)

__all__ = ["BraintrustCallbackHandler", "set_global_handler", "clear_global_handler"]
