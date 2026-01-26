"""Test auto_instrument for Anthropic."""

import anthropic
from braintrust.auto import auto_instrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Verify not patched initially
assert not getattr(anthropic, "__braintrust_wrapped__", False)

# 2. Instrument
results = auto_instrument()
assert results.get("anthropic") == True
assert getattr(anthropic, "__braintrust_wrapped__", False)

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

print("SUCCESS")
