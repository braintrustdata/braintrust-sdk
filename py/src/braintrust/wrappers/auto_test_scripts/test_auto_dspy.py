"""Test auto_instrument for DSPy.

Note: This test focuses on patching behavior only. Span verification for DSPy
is done in test_dspy.py::test_dspy_callback which uses pytest-vcr (supports httpx).
The standalone VCR in test_utils doesn't capture httpx used by litellm/dspy.
"""

import dspy
from braintrust.auto import auto_instrument
from braintrust.wrappers.dspy import BraintrustDSpyCallback

# 1. Verify not patched initially
assert not getattr(dspy, "__braintrust_wrapped__", False)

# 2. Instrument
results = auto_instrument()
assert results.get("dspy") == True
assert getattr(dspy, "__braintrust_wrapped__", False)

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("dspy") == True

# 4. Verify callback is added when configure() is called
dspy.configure(lm=None)
from dspy.dsp.utils.settings import settings

has_bt_callback = any(isinstance(cb, BraintrustDSpyCallback) for cb in settings.callbacks)
assert has_bt_callback, f"Expected BraintrustDSpyCallback in callbacks after configure()"

print("SUCCESS")
