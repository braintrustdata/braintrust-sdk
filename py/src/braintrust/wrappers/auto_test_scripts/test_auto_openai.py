"""Test auto_instrument/auto_uninstrument for OpenAI."""

import openai
from braintrust.auto import auto_instrument, auto_uninstrument
from braintrust.wrappers.test_utils import autoinstrument_test_context

# 1. Verify not patched initially
assert not hasattr(openai, "_braintrust_wrapped")

# 2. Instrument
results = auto_instrument()
assert results.get("openai") == True
assert hasattr(openai, "_braintrust_wrapped")

# 3. Idempotent
results2 = auto_instrument()
assert results2.get("openai") == True

# 4. Make API call and verify span
with autoinstrument_test_context("test_auto_openai") as memory_logger:
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say hi"}],
    )
    assert response.choices[0].message.content

    spans = memory_logger.pop()
    assert len(spans) == 1, f"Expected 1 span, got {len(spans)}"
    span = spans[0]
    assert span["metadata"]["provider"] == "openai"
    assert "gpt-4o-mini" in span["metadata"]["model"]

# 5. Uninstrument
results3 = auto_uninstrument()
assert results3.get("openai") == True
assert not hasattr(openai, "_braintrust_wrapped")

# 6. Verify no spans after uninstrument
with autoinstrument_test_context("test_auto_openai_uninstrumented") as memory_logger:
    client = openai.OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Say hi again"}],
    )
    assert response.choices[0].message.content

    spans = memory_logger.pop()
    assert len(spans) == 0, f"Expected 0 spans after uninstrument, got {len(spans)}"

print("SUCCESS")
