"""Test auto_instrument/auto_uninstrument for Anthropic."""

import anthropic
from braintrust.auto import auto_instrument, auto_uninstrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Verify not patched initially
assert not hasattr(anthropic, "_braintrust_wrapped")

# 2. Instrument
results = auto_instrument()
assert results.get("anthropic") == True
assert hasattr(anthropic, "_braintrust_wrapped")

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("anthropic") == True

# 4. Make API call and verify span
with autoinstrument_test_context("test_auto_anthropic") as memory_logger:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=100,
        messages=[{"role": "user", "content": "Say hi"}],
    )
    assert response.content[0].text

    spans = memory_logger.pop()
    assert len(spans) == 1, f"Expected 1 span, got {len(spans)}"
    span = spans[0]
    assert span["metadata"]["provider"] == "anthropic"
    assert "claude" in span["metadata"]["model"]

# 5. Uninstrument
results3 = auto_uninstrument()
assert results3.get("anthropic") == True
assert not hasattr(anthropic, "_braintrust_wrapped")

# 6. Verify no spans after uninstrument
with autoinstrument_test_context("test_auto_anthropic_uninstrumented") as memory_logger:
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=100,
        messages=[{"role": "user", "content": "Say hi again"}],
    )
    assert response.content[0].text

    spans = memory_logger.pop()
    assert len(spans) == 0, f"Expected 0 spans after uninstrument, got {len(spans)}"

print("SUCCESS")
