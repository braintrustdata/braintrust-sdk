"""Test auto_instrument for LiteLLM."""

import litellm
from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Verify not patched initially
assert not hasattr(litellm, "_braintrust_wrapped")

# 2. Instrument
results = auto_instrument()
assert results.get("litellm") == True
assert hasattr(litellm, "_braintrust_wrapped")

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("litellm") == True

# 4. Make API call and verify span
with autoinstrument_test_context("test_auto_litellm") as memory_logger:
    response = litellm.completion(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say hi"}],
    )
    assert response.choices[0].message.content

    spans = memory_logger.pop()
    assert len(spans) == 1, f"Expected 1 span, got {len(spans)}"
    span = spans[0]
    assert span["metadata"]["provider"] == "litellm"

print("SUCCESS")
