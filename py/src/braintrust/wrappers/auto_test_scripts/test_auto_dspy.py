"""Test auto_instrument/auto_uninstrument for DSPy."""

import dspy
from braintrust.auto import auto_instrument, auto_uninstrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Verify not patched initially
assert not hasattr(dspy, "_braintrust_wrapped")

# 2. Instrument
results = auto_instrument()
assert results.get("dspy") == True
assert hasattr(dspy, "_braintrust_wrapped")

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("dspy") == True

# 4. Make API call and verify span
with autoinstrument_test_context("test_auto_dspy") as memory_logger:
    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm)

    cot = dspy.ChainOfThought("question -> answer")
    result = cot(question="What is 2+2?")
    assert result.answer

    spans = memory_logger.pop()
    assert len(spans) >= 1, f"Expected at least 1 span, got {len(spans)}"

# 5. Uninstrument
results3 = auto_uninstrument()
assert results3.get("dspy") == True
assert not hasattr(dspy, "_braintrust_wrapped")

# 6. Verify no spans after uninstrument (need fresh configure)
with autoinstrument_test_context("test_auto_dspy_uninstrumented") as memory_logger:
    lm = dspy.LM("openai/gpt-4o-mini")
    dspy.configure(lm=lm, callbacks=[])  # Reset callbacks

    cot = dspy.ChainOfThought("question -> answer")
    result = cot(question="What is 3+3?")
    assert result.answer

    spans = memory_logger.pop()
    assert len(spans) == 0, f"Expected 0 spans after uninstrument, got {len(spans)}"

print("SUCCESS")
