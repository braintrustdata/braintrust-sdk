"""Test auto_instrument/auto_uninstrument for DSPy.

Note: This test focuses on patching behavior only. Span verification for DSPy
is done in test_dspy.py::test_dspy_callback which uses pytest-vcr (supports httpx).
The standalone VCR in test_utils doesn't capture httpx used by litellm/dspy.
"""

import dspy
from braintrust.auto import auto_instrument, auto_uninstrument
from braintrust.wrappers.dspy import BraintrustDSpyCallback

# 1. Verify not patched initially
assert not hasattr(dspy, "_braintrust_wrapped")

# 2. Instrument
results = auto_instrument()
assert results.get("dspy") == True
assert hasattr(dspy, "_braintrust_wrapped")

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("dspy") == True

# 4. Verify callback is added when configure() is called
dspy.configure(lm=None)
from dspy.dsp.utils.settings import settings

has_bt_callback = any(isinstance(cb, BraintrustDSpyCallback) for cb in settings.callbacks)
assert has_bt_callback, f"Expected BraintrustDSpyCallback in callbacks after configure()"

# 5. Uninstrument
results3 = auto_uninstrument()
assert results3.get("dspy") == True
assert not hasattr(dspy, "_braintrust_wrapped")

print("SUCCESS")
